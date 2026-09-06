import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { AuthContext } from '@/contexts/AuthContext';
import { getAuthPermissionRefresh } from '@/lib/authPermissionRefresh';
import {
  combineAbortSignals,
  createTimedAbortController,
  isRequestAbortError,
  isRequestTimeoutError,
} from '@/lib/requestControl';

export { useAuth } from '@/contexts/AuthContext';

// Cache for permissions and user data
const cache = {
  permissions: new Map(),
  memberData: new Map(),
  timestamp: new Map(),
  TTL: 60 * 1000,
};

const getCacheKey = (type, id) => `${type}_${id}`;

const isCacheValid = (key) => {
  const timestamp = cache.timestamp.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < cache.TTL;
};

const setCache = (key, data) => {
  cache.timestamp.set(key, Date.now());
  if (key.startsWith('permissions_')) {
    cache.permissions.set(key, data);
  } else if (key.startsWith('member_')) {
    cache.memberData.set(key, data);
  }
};

const getCache = (key) => {
  if (!isCacheValid(key)) return null;
  if (key.startsWith('permissions_')) {
    return cache.permissions.get(key);
  } else if (key.startsWith('member_')) {
    return cache.memberData.get(key);
  }
  return null;
};

const clearCache = () => {
  cache.permissions.clear();
  cache.memberData.clear();
  cache.timestamp.clear();
};

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [memberId, setMemberId] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isPrivateMode, setIsPrivateMode] = useState(false); 
  const currentUserIdRef = useRef(null);
  const authEventRunIdRef = useRef(0);
  const permissionsLoadedUserIdRef = useRef(null);
  const permissionsLoadingUserIdRef = useRef(null);
  const permissionAbortRef = useRef(null);

  const isSuperUser = useMemo(() => userRole === 'admin' || userRole === 'super_manager', [userRole]);

  const clearState = useCallback(() => {
    authEventRunIdRef.current += 1;
    permissionAbortRef.current?.abort();
    currentUserIdRef.current = null;
    permissionsLoadedUserIdRef.current = null;
    permissionsLoadingUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setMemberId(null);
    setPermissions({});
    setPermissionsReady(false);
    setIsAdmin(false);
    setUserRole(null);
    setIsPrivateMode(false);
    setLoading(false);
    setAuthError(null);
    clearCache();
  }, []);
  
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    clearState();

    if (error) {
        if (error.message !== 'Session from session_id claim in JWT does not exist' && error.message !== 'Invalid session') {
             console.error("Supabase sign out error:", error.message);
        }
    } else {
        toast({ title: "Byli jste odhlášeni." });
    }
  }, [toast, clearState]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });


    return { error };

  }, [toast]);

  const signInWithSso = useCallback(async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });


    return { error };

  }, [toast]);

  const togglePrivateMode = useCallback(async (enable) => {
    if (!memberId) return;
    
    setIsPrivateMode(enable);
    
    try {
        const { data: memberData } = await supabase
            .from('members')
            .select('notification_preferences')
            .eq('id', memberId)
            .single();
            
        const currentPrefs = memberData?.notification_preferences || {};
        const newPrefs = { ...currentPrefs, private_mode: enable };
        
        await supabase
            .from('members')
            .update({ notification_preferences: newPrefs })
            .eq('id', memberId);
            
    } catch (error) {
        console.error("Failed to save private mode preference", error);
    }
  }, [memberId]);

  const retryOperation = useCallback(async (operation, maxRetries = 2, delay = 1000) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        if (isRequestAbortError(err) && !isRequestTimeoutError(err)) throw err;
        if (attempt === maxRetries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }, []);

  const fetchPermissions = useCallback(async (currentUser, runSignal = null) => {
    if (!currentUser) {
      clearState();
      return;
    }

    const requestSignal = () => combineAbortSignals(runSignal, AbortSignal.timeout(8000));
    const assertCurrentRun = () => {
      if (runSignal?.aborted || currentUserIdRef.current !== currentUser.id) {
        throw new DOMException('Permission request is no longer current', 'AbortError');
      }
    };

    try {
      const accountStatus = await retryOperation(async () => {
        const { data, error } = await supabase
          .from('user_account_status')
          .select('status, reason')
          .eq('auth_user_id', currentUser.id)
          .maybeSingle()
          .abortSignal(requestSignal());
        if (error && error.code !== 'PGRST116') throw error;
        return data;
      });
      assertCurrentRun();

      if (accountStatus?.status === 'disabled') {
        toast({
          title: 'Účet je deaktivovaný',
          description: accountStatus.reason || 'Kontaktujte administrátora portálu.',
          variant: 'destructive',
        });
        await signOut();
        return;
      }

      const cacheKey = getCacheKey('permissions', currentUser.id);
      const cachedData = getCache(cacheKey);
      
      if (cachedData) {
        assertCurrentRun();
        setUserRole(cachedData.role);
        setIsAdmin(cachedData.isAdmin);
        setMemberId(cachedData.memberId);
        setPermissions(cachedData.permissions);
        setIsPrivateMode(cachedData.isPrivateMode);
        setPermissionsReady(true);
        return;
      }

      // Fetch user role with actual abort capability
      const userRoleData = await retryOperation(async () => {
        const { data, error } = await supabase.rpc('get_user_role')
          .abortSignal(requestSignal());
          
        if (error) throw error;
        return data;
      });

      const role = userRoleData;
      assertCurrentRun();
      setUserRole(role);
      
      const adminStatus = role === 'admin';
      setIsAdmin(adminStatus);
      
      let memberData = await retryOperation(async () => {
        const { data, error } = await supabase
          .from('members')
          .select('id, notification_preferences')
          .eq('auth_user_id', currentUser.id)
          .maybeSingle()
          .abortSignal(requestSignal());

        if (error && error.code !== 'PGRST116') throw error;
        return data;
      });

      if (!memberData) {
        memberData = await retryOperation(async () => {
          const { data, error } = await supabase
            .rpc('get_current_member_identity')
            .maybeSingle()
            .abortSignal(requestSignal());

          if (error && error.code !== 'PGRST116') throw error;
          return data;
        });
      }

      if (memberData) {
        assertCurrentRun();
        setMemberId(memberData.id);
        const prefs = memberData.notification_preferences || {};
        setIsPrivateMode(!!prefs.private_mode);
      } else {
        setMemberId(null);
      }

      const permsData = await retryOperation(async () => {
        const { data, error } = await supabase.rpc('get_permissions', { p_role: role })
          .abortSignal(requestSignal());

        if (error) throw error;
        return data;
      });
      const finalPermissions = permsData || {};

      assertCurrentRun();
      setPermissions(finalPermissions);
      setPermissionsReady(true);

      setCache(cacheKey, {
        role,
        isAdmin: adminStatus,
        memberId: memberData?.id || null,
        permissions: finalPermissions,
        isPrivateMode: memberData?.notification_preferences?.private_mode || false,
      });

    } catch(error) {
      if (runSignal?.aborted || isRequestAbortError(error)) throw error;
      console.error("An unexpected error occurred during permission fetch:", error);

      if (error.details === 'ACCOUNT_DISABLED' || error.message === 'Account is disabled.') {
        toast({ title: 'Účet je deaktivovaný', description: 'Kontaktujte administrátora portálu.', variant: 'destructive' });
        await signOut();
        return;
      }

      if (error.message?.includes('JWT') || error.message?.includes('token')) {
        toast({ 
          title: 'Relace vypršela',
          description: 'Přihlaste se prosím znovu.',
          variant: 'destructive'
        });
        await signOut();
        return;
      }

      throw error;
    }
  }, [clearState, toast, signOut, retryOperation]);

  const loadPermissionsForUser = useCallback(async (
    currentUser,
    { foreground = true, invalidateCache = false } = {}
  ) => {
    if (!currentUser) return false;

    const runId = authEventRunIdRef.current + 1;
    authEventRunIdRef.current = runId;
    permissionAbortRef.current?.abort();
    const permissionRequest = createTimedAbortController(20_000);
    permissionAbortRef.current = permissionRequest.controller;
    permissionsLoadingUserIdRef.current = currentUser.id;

    if (invalidateCache) clearCache();
    setAuthError(null);
    if (foreground) {
      setPermissionsReady(false);
      setLoading(true);
    }

    try {
      await fetchPermissions(currentUser, permissionRequest.signal);
      if (authEventRunIdRef.current !== runId || currentUserIdRef.current !== currentUser.id) return false;
      permissionsLoadedUserIdRef.current = currentUser.id;
      return true;
    } catch (error) {
      const superseded = permissionRequest.signal.aborted && !isRequestTimeoutError(
        permissionRequest.signal.reason || error
      );
      if (superseded || authEventRunIdRef.current !== runId) return false;

      console.error("Error loading auth permissions:", error);
      const message = isRequestTimeoutError(error) || isRequestTimeoutError(permissionRequest.signal.reason)
        ? 'Načítání oprávnění překročilo časový limit. Zkontrolujte připojení a zkuste to znovu.'
        : 'Oprávnění se nepodařilo načíst. Zkuste akci zopakovat.';
      setAuthError(message);
      // A failed background refresh must never keep stale administrator access.
      setPermissionsReady(false);
      setPermissions({});
      setIsAdmin(false);
      setUserRole(null);
      permissionsLoadedUserIdRef.current = null;
      toast({
        title: 'Načítání oprávnění selhalo',
        description: message,
        variant: 'destructive',
      });
      return false;
    } finally {
      permissionRequest.dispose();
      if (permissionAbortRef.current === permissionRequest.controller) {
        permissionAbortRef.current = null;
      }
      if (permissionsLoadingUserIdRef.current === currentUser.id && authEventRunIdRef.current === runId) {
        permissionsLoadingUserIdRef.current = null;
      }
      if (authEventRunIdRef.current === runId && foreground) setLoading(false);
    }
  }, [fetchPermissions, toast]);

  const retryPermissions = useCallback(async () => {
    if (!user) return false;
    return loadPermissionsForUser(user, { foreground: true, invalidateCache: true });
  }, [loadPermissionsForUser, user]);

  useEffect(() => {
    let isMounted = true;
    let permissionLoadTimer;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!isMounted) return;

        const nextUser = nextSession?.user ?? null;
        const previousUserId = currentUserIdRef.current;
        const nextUserId = nextUser?.id ?? null;

        setSession(nextSession);
        setUser(nextUser);

        if (event === 'SIGNED_OUT' || !nextUser) {
          clearTimeout(permissionLoadTimer);
          clearState();
          return;
        }

        currentUserIdRef.current = nextUserId;

        const refreshOptions = getAuthPermissionRefresh({
          event,
          userId: nextUserId,
          previousUserId,
          loadedUserId: permissionsLoadedUserIdRef.current,
          loadingUserId: permissionsLoadingUserIdRef.current,
        });
        if (!refreshOptions) return;

        if (refreshOptions.foreground) {
          setPermissionsReady(false);
          setLoading(true);
        }
        clearTimeout(permissionLoadTimer);
        // Leave Supabase's synchronous auth callback before issuing authenticated
        // requests. Refreshes revalidate in the background without remounting routes.
        permissionLoadTimer = setTimeout(() => {
          if (isMounted && currentUserIdRef.current === nextUserId) {
            void loadPermissionsForUser(nextUser, refreshOptions);
          }
        }, 0);
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(permissionLoadTimer);
      authEventRunIdRef.current += 1;
      permissionAbortRef.current?.abort();
      subscription?.unsubscribe();
    };
  }, [clearState, loadPermissionsForUser]);

  useEffect(() => {
    if (!user?.id || !memberId) return undefined;

    const channel = supabase
      .channel(`permission-refresh-${memberId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_permission_overrides', filter: `member_id=eq.${memberId}` },
        () => void loadPermissionsForUser(user, { foreground: false, invalidateCache: true })
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'members', filter: `id=eq.${memberId}` },
        () => void loadPermissionsForUser(user, { foreground: false, invalidateCache: true })
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPermissionsForUser, memberId, user]);

  const hasPermission = useCallback((module, level = 'can_read') => {
    if (isAdmin) return true;
    if (!module || !level) return false;
    const modulePermissions = permissions[module];
    if (!modulePermissions) return false;
    return modulePermissions[level];
  }, [permissions, isAdmin]);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    authError,
    permissionsReady,
    permissions,
    isAdmin,
    memberId,
    userRole,
    isSuperUser,
    hasPermission,
    signOut,
    signIn,
    signInWithSso,
    retryPermissions,

    isPrivateMode,
    togglePrivateMode,
  }), [user, session, loading, authError, permissionsReady, permissions, isAdmin, memberId, userRole, isSuperUser, hasPermission, signOut, signIn, signInWithSso, retryPermissions, isPrivateMode, togglePrivateMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
