import { Home, Folder, HardHat, CalendarDays, CheckSquare, Clock, Contact, Building2, Package, Wallet, FileText, BarChart3, Settings, Users, Wrench, PieChart, LayoutDashboard, Copy } from 'lucide-react';

export const PORTAL_NAVIGATION = [
  { label: 'Práce', items: [
    { label: 'Moje práce', path: '/', icon: Home, exact: true },
    { label: 'Projekce', path: '/projects', icon: Folder, module: 'projects' },
    { label: 'Realizace', path: '/realizace', icon: HardHat, module: 'realizace' },
    { label: 'Plánování', path: '/planning', icon: CalendarDays },
    { label: 'Úkoly', path: '/tasks', icon: CheckSquare, module: 'tasks' },
    { label: 'Docházka', path: '/attendance', icon: Clock, module: 'attendance' },
    { label: 'Moje zázemí', path: '/employee', icon: Contact },
  ] },
  { label: 'Obchod', items: [
    { label: 'CRM', path: '/crm', icon: Contact, module: 'crm' },
    { label: 'Subjekty', path: '/subjects', icon: Building2, module: 'subjects' },
    { label: 'Produkty', path: '/products', icon: Package, module: 'crm' },
  ] },
  { label: 'Firma', items: [
    { label: 'Výplaty', path: '/payouts', icon: Wallet, module: 'payouts' },
    { label: 'Dokumenty', path: '/documents', icon: FileText, module: 'documents' },
    { label: 'Inženýring', path: '/engineering', icon: Wrench, module: 'engineering' },
    { label: 'Zaměstnanci', path: '/members', icon: Users, module: 'members' },
    { label: 'Přehled firmy', path: '/dashboard', icon: LayoutDashboard, module: 'dashboard' },
    { label: 'Režijní náklady', path: '/overhead-costs', icon: PieChart, module: 'finance', level: 'can_admin' },
    { label: 'Reporty', path: '/reports', icon: BarChart3, module: 'reports' },
    { label: 'Šablony projektů', path: '/templates', icon: Copy, module: 'projects' },
  ] },
];
export const SETTINGS_NAV = { label: 'Nastavení', path: '/settings', icon: Settings, module: 'settings' };
export const CRM_NAVIGATION = [
  { label: 'Obchodní nástěnka', path: '/crm/board', icon: LayoutDashboard, module: 'crm' },
  { label: 'Obchodní případy', path: '/crm/opportunities', icon: Contact, module: 'crm' },
  { label: 'Nabídky', path: '/crm/offers', icon: FileText, module: 'crm' },
  { label: 'Objednávky', path: '/crm/orders', icon: Copy, module: 'crm' },
];
export const ALL_PORTAL_NAVIGATION = [...PORTAL_NAVIGATION.flatMap(g => g.items), ...CRM_NAVIGATION, SETTINGS_NAV];
export const canNavigate = (item, hasPermission) => !item.module || hasPermission(item.module, item.level || 'can_read');
export const getPortalSection = (pathname) => pathname.startsWith('/employees/') ? { label: 'Zaměstnanecká karta', path: '/employee' } : ALL_PORTAL_NAVIGATION
  .filter(item => item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`))
  .sort((a, b) => b.path.length - a.path.length)[0] || { label: 'Portál', path: '/' };
