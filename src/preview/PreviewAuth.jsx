import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { AuthContext, useAuth } from '../contexts/AuthContext.jsx';
import { getPreviewRole, setPreviewRole, subscribePreviewRole, PREVIEW_DATE } from './previewState.js';
import { getPreviewUser, getPreviewMember, resetPreviewData } from './supabasePreviewClient.js';

const workerRead = new Set(['dashboard', 'projects', 'realizace', 'tasks', 'attendance', 'documents', 'payouts', 'settings']);
const workerEdit = new Set(['tasks', 'attendance', 'payouts']);

export function AuthProvider({ children }) {
  const role = useSyncExternalStore(subscribePreviewRole, getPreviewRole);
  const [isPrivateMode, setPrivateMode] = useState(false);
  const [notice, setNotice] = useState('Změny zůstávají jen v tomto prohlížeči.');
  const hasPermission = useCallback((module, level = 'can_read') => role === 'admin'
    || (level === 'can_read' ? workerRead.has(module) : level === 'can_edit' ? workerEdit.has(module) : false), [role]);
  const signOut = useCallback(async () => setNotice('Jde o izolovaný náhled. Žádný skutečný účet není přihlášen.'), []);
  const value = useMemo(() => {
    const user = getPreviewUser();
    return {
      user, session: { user, access_token: null }, loading: false, authError: null, permissionsReady: true,
      memberId: getPreviewMember().id, userRole: role === 'admin' ? 'admin' : 'user', isAdmin: role === 'admin',
      isSuperUser: role === 'admin', hasPermission, isPrivateMode, togglePrivateMode: setPrivateMode, signOut,
      permissions: Object.fromEntries([...workerRead, 'crm', 'members', 'finance', 'reports', 'subjects', 'engineering'].map(module => [module, {
        can_read: hasPermission(module), can_edit: hasPermission(module, 'can_edit'), can_admin: hasPermission(module, 'can_admin'),
      }])),
      retryPermissions: async () => true,
      signIn: async () => ({ error: new Error('Přihlášení se v náhledu nespouští.') }),
      signInWithSso: async () => ({ error: new Error('SSO se v náhledu nespouští.') }),
    };
  }, [role, hasPermission, isPrivateMode, signOut]);
  return <AuthContext.Provider value={value}>
    {children}
    <aside className="ekv-preview-toolbar" aria-label="Ovládání ukázkového náhledu">
      <div><strong>Ukázková data</strong><span>{PREVIEW_DATE} · bez připojení k serveru</span></div>
      <label>Role<select aria-label="Role v náhledu" value={role} onChange={event => setPreviewRole(event.target.value)}><option value="admin">Administrátor</option><option value="member">Pracovník</option></select></label>
      <button type="button" onClick={() => { resetPreviewData(); window.location.reload(); }}>Obnovit data</button>
      <small role="status">{notice}</small>
    </aside>
  </AuthContext.Provider>;
}
export { useAuth };
