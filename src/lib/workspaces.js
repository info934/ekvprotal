export const WORKSPACES = {
  crm: {
    id: 'crm',
    label: 'CRM',
    title: 'CRM',
    description: 'Obchod, subjekty, příležitosti, nabídky a objednávky.',
    path: '/crm',
    modules: ['crm', 'subjects'],
  },
  portal: {
    id: 'portal',
    label: 'Portal',
    title: 'Portal',
    description: 'Projekce, realizace, provoz, finance a správa.',
    path: '/dashboard',
    modules: ['dashboard', 'projects', 'realizace', 'engineering', 'tasks', 'attendance', 'members', 'documents', 'payouts', 'finance', 'reports', 'settings'],
  },
};

const CRM_PATH_PREFIXES = ['/crm', '/subjects', '/products'];

export const getWorkspaceFromPathname = (pathname = '') => (
  CRM_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? WORKSPACES.crm.id
    : WORKSPACES.portal.id
);

export const canAccessWorkspace = (workspace, hasPermission) => {
  if (!workspace || typeof hasPermission !== 'function') return false;
  return workspace.modules.some(module => hasPermission(module));
};
