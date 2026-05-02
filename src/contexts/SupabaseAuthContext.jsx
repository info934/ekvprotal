import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

// Cache for permissions and user data
const cache = {
  permissions: new Map(),
  memberData: new Map(),
  timestamp: new Map(),
  TTL: 5 * 60 * 1000, // 5 minutes
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

  const signUp = useCallback(async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Registrace se nezdařila",
        description: error.message || "Něco se pokazilo",
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Přihlášení se nezdařilo",
        description: error.message || "Neplatné přihlašovací údaje",
      });
    }

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
        if (attempt === maxRetries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }, []);

  const fetchPermissions = useCallback(async (currentUser) => {
    if (!currentUser) {
      clearState();
      return;
    }

    try {
      const cacheKey = getCacheKey('permissions', currentUser.id);
      const cachedData = getCache(cacheKey);
      
      if (cachedData) {
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
          .abortSignal(AbortSignal.timeout(8000));
          
        if (error) throw error;
        return data;
      });

      const role = userRoleData;
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
            .abortSignal(AbortSignal.timeout(8000));
            
          if (error && error.code !== 'PGRST116') throw error;
          return data;
        });
      } catch (err) {
        console.error("Error fetching member ID:", err);
      }

      if (memberData) {
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
               .abortSignal(AbortSignal.timeout(8000));
               
             if (error) throw error;
             return data;
          });
          
          const basicPermissions = {
              dashboard: { can_read: true, can_edit: false, can_admin: false },
              projects: { can_read: true, can_edit: false, can_admin: false },
              realizace: { can_read: true, can_edit: true, can_admin: false },
              tasks: { can_read: true, can_edit: true, can_admin: false },
          };
          
          finalPermissions = { ...basicPermissions, ...(permsData || {}) };
          
        } catch (err) {
          console.error("Error fetching permissions:", err);
          finalPermissions = {
            dashboard: { can_read: true, can_edit: false, can_admin: false },
            projects: { can_read: true, can_edit: false, can_admin: false },
            realizace: { can_read: true, can_edit: true, can_admin: false },
            tasks: { can_read: true, can_edit: true, can_admin: false },
          };
        }
      }

      setPermissions(finalPermissions);

      setCache(cacheKey, {
        role,
        isAdmin: adminStatus,
        memberId: memberData?.id || null,
        permissions: finalPermissions,
        isPrivateMode: memberData?.notification_preferences?.private_mode || false,
      });

    } catch(error) {
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
      
      setPermissions({
        dashboard: { can_read: true, can_edit: false, can_admin: false },
        projects: { can_read: true, can_edit: false, can_admin: false },
        realizace: { can_read: true, can_edit: true, can_admin: false },
      });
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
            await withTimeout(
              fetchPermissions(currentUser),
              20000,
              'Permission loading'
            );
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

        if (nextUserId === previousUserId && permissionsLoadedUserIdRef.current === nextUserId) {
          currentUserIdRef.current = nextUserId;
          setLoading(false);
          return;
        }

        currentUserIdRef.current = nextUserId;
        permissionsLoadedUserIdRef.current = null;
        setLoading(true);
        const runId = authEventRunIdRef.current + 1;
        authEventRunIdRef.current = runId;

        setTimeout(async () => {
          try {
            await withTimeout(
              fetchPermissions(newCurrentUser),
              20000,
              'Permission loading'
            );
            permissionsLoadedUserIdRef.current = newCurrentUser.id;
          } catch (error) {
            console.error("Error loading auth permissions:", error);
            toast({
              title: 'Načítání oprávnění selhalo',
              description: 'Zkuste prosím obnovit stránku nebo se přihlásit znovu.',
              variant: 'destructive',
            });
          } finally {
            if (isMounted && authEventRunIdRef.current === runId) {
              setLoading(false);
            }
          }
        }, 0);
      }
    );

    return () => {
      isMounted = false;
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
    signUp,
    isPrivateMode,
    togglePrivateMode,
  }), [user, session, loading, permissions, isAdmin, memberId, userRole, isSuperUser, hasPermission, signOut, signIn, signUp, isPrivateMode, togglePrivateMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
