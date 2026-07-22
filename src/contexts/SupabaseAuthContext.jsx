import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { combineAbortSignals, createTimedAbortController, isRequestAbortError } from '@/lib/requestControl';

const AuthContext = createContext(undefined);

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

const withTimeout = (promise, timeoutMs, label) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [memberId, setMemberId] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isPrivateMode, setIsPrivateMode] = useState(false); 
  const currentUserIdRef = useRef(null);
  const authEventRunIdRef = useRef(0);
  const permissionsLoadedUserIdRef = useRef(null);
  const permissionAbortRef = useRef(null);
  const authEventTimerRef = useRef(null);

  const isSuperUser = useMemo(() => userRole === 'admin' || userRole === 'super_manager', [userRole]);

  const clearState = useCallback(() => {
    currentUserIdRef.current = null;
    permissionsLoadedUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setMemberId(null);
    setPermissions({});
    setIsAdmin(false);
    setUserRole(null);
    setIsPrivateMode(false);
    setLoading(false);
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

  // Session Timeout Handler
  useEffect(() => {
    if (!session?.expires_at) return;
    
    const expiresAtMs = session.expires_at * 1000;
    const timeUntilExpiry = expiresAtMs - Date.now();
    
    // Set a timeout to log out when session expires (minus 10 seconds for buffer)
    if (timeUntilExpiry > 0) {
      const timeoutId = setTimeout(async () => {
        toast({ title: "Relace vypršela", description: "Z bezpečnostních důvodů jste byli odhlášeni.", variant: "warning" });
        await signOut();
      }, timeUntilExpiry - 10000);
      return () => clearTimeout(timeoutId);
    } else {
      signOut();
    }
  }, [session, signOut, toast]);

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
        if (isRequestAbortError(err)) throw err;
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
      const { data: accountStatus, error: accountStatusError } = await supabase
        .from('user_account_status')
        .select('status, reason')
        .eq('auth_user_id', currentUser.id)
        .maybeSingle()
        .abortSignal(requestSignal());
      assertCurrentRun();

      if (accountStatusError && accountStatusError.code !== 'PGRST116' && accountStatusError.code !== '42P01') {
        throw accountStatusError;
      }

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
      
      let memberData = null;
      try {
        memberData = await retryOperation(async () => {
          const { data, error } = await supabase
            .from('members')
            .select('id, notification_preferences')
            .eq('auth_user_id', currentUser.id)
            .single()
            .abortSignal(requestSignal());
            
          if (error && error.code !== 'PGRST116') throw error;
          return data;
        });
      } catch (err) {
        console.error("Error fetching member ID:", err);
      }

      if (memberData) {
        assertCurrentRun();
        setMemberId(memberData.id);
        const prefs = memberData.notification_preferences || {};
        setIsPrivateMode(!!prefs.private_mode);
      } else {
        setMemberId(null);
      }

      let finalPermissions = {};

      if (adminStatus) {
        finalPermissions = {
          dashboard: { can_read: true, can_edit: true, can_admin: true },
          projects: { can_read: true, can_edit: true, can_admin: true },
          tasks: { can_read: true, can_edit: true, can_admin: true },
          attendance: { can_read: true, can_edit: true, can_admin: true },
          documents: { can_read: true, can_edit: true, can_admin: true },
          crm: { can_read: true, can_edit: true, can_admin: true },
          subjects: { can_read: true, can_edit: true, can_admin: true },
          engineering: { can_read: true, can_edit: true, can_admin: true },
          members: { can_read: true, can_edit: true, can_admin: true },
          payouts: { can_read: true, can_edit: true, can_admin: true },
          finance: { can_read: true, can_edit: true, can_admin: true },
          reports: { can_read: true, can_edit: true, can_admin: true },
          settings: { can_read: true, can_edit: true, can_admin: true },
          realizace: { can_read: true, can_edit: true, can_admin: true },
        };
      } else {
        try {
          const permsData = await retryOperation(async () => {
             const { data, error } = await supabase.rpc('get_permissions', { p_role: role })
               .abortSignal(requestSignal());
               
             if (error) throw error;
             return data;
          });
          
          finalPermissions = permsData || {};
          
        } catch (err) {
          console.error("Error fetching permissions:", err);
          finalPermissions = {};
        }
      }

      assertCurrentRun();
      setPermissions(finalPermissions);

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
      
      if (error.message?.includes('JWT') || error.message?.includes('token') || error.message?.includes('timeout') || error.name === 'TimeoutError') {
        toast({ 
          title: 'Relace vypršela nebo timeout', 
          description: 'Prosím přihlaste se znovu nebo zkontrolujte připojení.',
          variant: 'destructive'
        });
        await signOut();
        return;
      }
      
      toast({ title: 'Nastala chyba při načítání dat.', variant: 'destructive'});
      
      setPermissions({});
    }
  }, [clearState, toast, signOut, retryOperation]);

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          8000,
          'Auth session initialization'
        );
        
        if (isMounted) {
          setSession(session);
          const currentUser = session?.user ?? null;
          currentUserIdRef.current = currentUser?.id ?? null;
          setUser(currentUser);
          
          if (currentUser) {
            const permissionRequest = createTimedAbortController(20_000);
            permissionAbortRef.current?.abort();
            permissionAbortRef.current = permissionRequest.controller;
            try {
              await fetchPermissions(currentUser, permissionRequest.signal);
            } finally {
              permissionRequest.dispose();
            }
            permissionsLoadedUserIdRef.current = currentUser.id;
          }
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        if (isMounted) {
          clearState();
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;

        const newCurrentUser = session?.user ?? null;
        const previousUserId = currentUserIdRef.current;
        const nextUserId = newCurrentUser?.id ?? null;

        setSession(session);
        setUser(newCurrentUser);

        if (_event === 'SIGNED_OUT' || !newCurrentUser) {
          clearState();
          return;
        }

        const mustRefreshPermissions = _event === 'TOKEN_REFRESHED' || _event === 'USER_UPDATED';
        if (!mustRefreshPermissions && nextUserId === previousUserId && permissionsLoadedUserIdRef.current === nextUserId) {
          currentUserIdRef.current = nextUserId;
          setLoading(false);
          return;
        }

        currentUserIdRef.current = nextUserId;
        permissionsLoadedUserIdRef.current = null;
        if (mustRefreshPermissions) clearCache();
        setLoading(true);
        const runId = authEventRunIdRef.current + 1;
        authEventRunIdRef.current = runId;
        permissionAbortRef.current?.abort();
        if (authEventTimerRef.current) clearTimeout(authEventTimerRef.current);
        const permissionRequest = createTimedAbortController(20_000);
        permissionAbortRef.current = permissionRequest.controller;

        authEventTimerRef.current = setTimeout(async () => {
          try {
            await fetchPermissions(newCurrentUser, permissionRequest.signal);
            if (!isMounted || authEventRunIdRef.current !== runId) return;
            permissionsLoadedUserIdRef.current = newCurrentUser.id;
          } catch (error) {
            if (isRequestAbortError(error) || !isMounted || authEventRunIdRef.current !== runId) return;
            console.error("Error loading auth permissions:", error);
            toast({
              title: 'Načítání oprávnění selhalo',
              description: 'Zkuste prosím obnovit stránku nebo se přihlásit znovu.',
              variant: 'destructive',
            });
          } finally {
            permissionRequest.dispose();
            if (isMounted && authEventRunIdRef.current === runId) {
              setLoading(false);
            }
          }
        }, 0);
      }
    );

    return () => {
      isMounted = false;
      permissionAbortRef.current?.abort();
      if (authEventTimerRef.current) clearTimeout(authEventTimerRef.current);
      subscription?.unsubscribe();
    };
  }, []);

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
    permissions,
    isAdmin,
    memberId,
    userRole,
    isSuperUser,
    hasPermission,
    signOut,
    signIn,
    signInWithSso,

    isPrivateMode,
    togglePrivateMode,
  }), [user, session, loading, permissions, isAdmin, memberId, userRole, isSuperUser, hasPermission, signOut, signIn, signInWithSso, isPrivateMode, togglePrivateMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
