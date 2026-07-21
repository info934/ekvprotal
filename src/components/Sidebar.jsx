import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart,
  Briefcase,
  Building,
  GanttChart,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,
  Contact,
  Copy,
  DollarSign,
  EyeOff,
  FilePieChart,
  FileText,
  Folder,
  HardHat,
  Home,
  ListTodo,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  Target,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import { WORKSPACES, canAccessWorkspace, getWorkspaceFromPathname } from '@/lib/workspaces';

const FAVORITES_KEY = 'ekv-sidebar-favorites';
const COLLAPSED_KEY = 'ekv-sidebar-collapsed';
const DEFAULT_FAVORITES = ['/dashboard', '/projects', '/realizace'];

const NAV_GROUPS = [
  {
    id: 'home',
    label: null,
    items: [
      { icon: Home, label: 'Rozcestník', path: '/', workspace: 'global', exact: true },
      { icon: Home, label: 'Přehled', path: '/dashboard', module: 'dashboard', workspace: 'portal' },
    ],
  },
  {
    id: 'work',
    label: 'Práce',
    items: [
      { icon: Folder, label: 'Projekce', path: '/projects', module: 'projects', workspace: 'portal' },
      { icon: HardHat, label: 'Realizace', path: '/realizace', module: 'realizace', workspace: 'portal' },
      { icon: GanttChart, label: 'Plánování', path: '/planning', workspace: 'portal' },
      { icon: Wrench, label: 'Inženýring', path: '/engineering', module: 'engineering', workspace: 'portal' },
      { icon: ListTodo, label: 'Úkoly', path: '/tasks', module: 'tasks', workspace: 'portal' },
    ],
  },
  {
    id: 'business',
    label: 'Obchod',
    items: [
      {
        icon: Contact,
        label: 'CRM nástěnka',
        path: '/crm',
        module: 'crm',
        workspace: 'crm',
        exact: true,
        children: [
          { icon: BarChart, label: 'CRM přehled', path: '/crm', module: 'crm', workspace: 'crm' },
          { icon: BarChart, label: 'Obchodní nástěnka', path: '/crm/board', module: 'crm', workspace: 'crm' },
          { icon: Target, label: 'Obchodní případy', path: '/crm/opportunities', module: 'crm', workspace: 'crm' },
          { icon: FileText, label: 'Nabídky', path: '/crm/offers', module: 'crm', workspace: 'crm' },
          { icon: ClipboardList, label: 'Objednávky', path: '/crm/orders', module: 'crm', workspace: 'crm' },
          { icon: Building, label: 'Subjekty', path: '/subjects', module: 'subjects', workspace: 'crm' },
        ],
      },
      { icon: Package, label: 'Produkty', path: '/products', module: 'crm', workspace: 'crm' },
    ],
  },
  {
    id: 'operations',
    label: 'Provoz',
    items: [
      { icon: Clock, label: 'Docházka', path: '/attendance', module: 'attendance', workspace: 'portal' },
      { icon: Users, label: 'Zaměstnanci', path: '/members', module: 'members', workspace: 'portal' },
      { icon: FileText, label: 'Dokumenty', path: '/documents', module: 'documents', workspace: 'portal' },
      { icon: Copy, label: 'Šablony projektu', path: '/templates', module: 'projects', workspace: 'portal' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      {
        icon: DollarSign,
        label: 'Výplaty',
        path: '/payouts',
        module: 'payouts',
        workspace: 'portal',
      },
      {
        icon: FilePieChart,
        label: 'Režijní náklady',
        path: '/overhead-costs',
        module: 'finance',
        level: 'can_admin',
        workspace: 'portal',
      },
      {
        icon: BarChart,
        label: 'Reporty',
        path: '/reports',
        module: 'reports',
        workspace: 'portal',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Správa',
    items: [
      { icon: Settings, label: 'Nastavení', path: '/settings', module: 'settings', exact: true, workspace: 'portal' },
      { icon: UserCog, label: 'Správa uživatelů', path: '/settings/users', module: 'settings', level: 'can_admin', workspace: 'portal' },
      { icon: Shield, label: 'Oprávnění', path: '/settings/permissions', module: 'settings', level: 'can_admin', workspace: 'portal' },
    ],
  },
];

const QUICK_ACTIONS = [
  { icon: Plus, label: 'Nový projekt', path: '/projects/new', module: 'projects', level: 'can_edit', workspace: 'portal' },
  { icon: Briefcase, label: 'Nová realizace', path: '/realizace/new', module: 'realizace', level: 'can_edit', workspace: 'portal' },
  { icon: ClipboardList, label: 'Nový úkol', path: '/tasks', module: 'tasks', level: 'can_edit', workspace: 'portal' },
  { icon: Target, label: 'Nový případ', path: '/crm/new', module: 'crm', level: 'can_edit', workspace: 'crm' },
  { icon: FileText, label: 'Nabídky', path: '/crm/offers', module: 'crm', workspace: 'crm' },
  { icon: Building, label: 'Subjekty', path: '/subjects', module: 'subjects', workspace: 'crm' },
];

const flattenItems = (groups) => groups.flatMap(group =>
  group.items.flatMap(item => [item, ...(item.children || [])])
);

const ALL_NAV_ITEMS = flattenItems(NAV_GROUPS);
const ALL_NAV_PATHS = new Set(ALL_NAV_ITEMS.map(item => item.path));
const SEARCH_ALIASES = {
  '/dashboard': 'nástěnka souhrn firma kpi',
  '/projects': 'projekty projekční dokumentace zakázky',
  '/realizace': 'realizace stavba montáž zakázky',
  '/planning': 'plán kalendář gantt kapacity zdroje',
  '/tasks': 'úkol agenda práce',
  '/crm': 'obchod pipeline crm dashboard',
  '/crm/board': 'kanban pipeline obchod',
  '/crm/opportunities': 'op příležitost obchodní případ',
  '/crm/offers': 'nabídka cenová kalkulace',
  '/crm/orders': 'objednávka obj',
  '/subjects': 'firma klient kontakt adresář dodavatel',
  '/products': 'produkt katalog ceník položka materiál',
  '/attendance': 'docházka hodiny výkaz práce',
  '/members': 'zaměstnanec pracovník lidé tým',
  '/payouts': 'výplata mzda odměna faktura',
  '/settings': 'nastavení konfigurace číselník',
};

const normalizeSearch = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('cs')
  .trim();

const NAV_SEARCH_INDEX = NAV_GROUPS.flatMap(group => group.items.flatMap(item => {
  const children = item.children || [];
  const parentEntry = children.some(child => child.path === item.path)
    ? []
    : [{ ...item, groupLabel: group.label || 'Hlavní', parentLabel: null }];

  return [
    ...parentEntry,
    ...children.map(child => ({
      ...child,
      groupLabel: group.label || 'Hlavní',
      parentLabel: item.label,
    })),
  ];
}));

const loadFavorites = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    if (!Array.isArray(stored)) return DEFAULT_FAVORITES;
    return [...new Set(stored.filter(path => typeof path === 'string' && ALL_NAV_PATHS.has(path)))];
  } catch {
    return DEFAULT_FAVORITES;
  }
};

const canSeeItem = (item, hasPermission) => !item.module || hasPermission(item.module, item.level || 'can_read');

const belongsToWorkspace = (item, workspace) => item.workspace === 'global' || item.workspace === workspace;

const filterGroupsForWorkspace = (groups, workspace) => groups
  .map(group => ({
    ...group,
    items: group.items
      .filter(item => belongsToWorkspace(item, workspace))
      .map(item => ({
        ...item,
        children: (item.children || []).filter(child => belongsToWorkspace(child, workspace)),
      })),
  }))
  .filter(group => group.items.length > 0);

const UserProfile = React.memo(({ isCollapsed }) => {
  const { user, isPrivateMode, togglePrivateMode, isAdmin } = useAuth();
  const [isPrivateDialogOpen, setIsPrivateDialogOpen] = useState(false);

  if (!user) return null;

  const fullName = user.user_metadata?.full_name || 'Uživatel';
  const email = user.email;
  const avatarUrl = user.user_metadata?.avatar_url;
  const fallback = fullName.split(' ').map(name => name[0]).join('').toUpperCase() || 'U';

  const handlePrivateToggle = () => {
    if (isPrivateMode) {
      togglePrivateMode(false);
    } else {
      setIsPrivateDialogOpen(true);
    }
  };

  return (
    <>
      <div className={cn(
        'mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900/80',
        isCollapsed && 'justify-center'
      )}>
        <div className="relative">
          <Avatar className="h-8 w-8 ring-1 ring-white dark:ring-gray-800">
            <AvatarImage src={avatarUrl} alt={fullName} loading="lazy" />
            <AvatarFallback className="bg-slate-800 text-xs font-semibold text-white">{fallback}</AvatarFallback>
          </Avatar>
          <div className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white dark:border-gray-800', isPrivateMode ? 'bg-red-500' : 'bg-green-500')} />
        </div>

        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="min-w-0 flex-1 overflow-hidden"
            >
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-gray-100">{fullName}</div>
              <div className="truncate text-[11px] text-slate-500 dark:text-gray-400">{email}</div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <Badge variant={isPrivateMode ? 'destructive' : 'success'} className="h-5 text-[10px]">
                  {isPrivateMode ? 'Privátní' : 'Aktivní'}
                </Badge>
                {isAdmin && (
                  <Button variant="ghost" size="icon" onClick={handlePrivateToggle} className="h-6 w-6" title="Privátní režim" aria-label="Přepnout privátní režim">
                    <EyeOff className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={isPrivateDialogOpen} onOpenChange={setIsPrivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aktivovat privátní režim?</AlertDialogTitle>
            <AlertDialogDescription>
              V privátním režimu budou skryty finanční údaje napříč aplikací. Režim můžete kdykoliv vypnout v panelu uživatele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={() => { togglePrivateMode(true); setIsPrivateDialogOpen(false); }}>Aktivovat</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

const SearchBox = ({ value, onChange, isCollapsed }) => {
  if (isCollapsed) return null;

  return (
    <div className="mb-2.5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Hledat v portálu..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Hledat stránku nebo modul v portálu"
          autoComplete="off"
          className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-8 text-[13px] text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-100"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            aria-label="Vymazat hledání v menu"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

const QuickActions = ({ isCollapsed, onLinkClick, workspace }) => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const visibleActions = QUICK_ACTIONS
    .filter(action => belongsToWorkspace(action, workspace))
    .filter(action => canSeeItem(action, hasPermission));

  if (isCollapsed || visibleActions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="mb-3 h-9 w-full justify-between rounded-md px-3 text-[13px] font-semibold shadow-sm">
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nový záznam
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-56">
        <DropdownMenuLabel>Vytvořit v zóně {WORKSPACES[workspace]?.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {visibleActions.map(action => (
          <DropdownMenuItem
            key={`${action.path}-${action.label}`}
            onSelect={() => {
              navigate(action.path);
              onLinkClick?.();
            }}
            className="gap-2"
          >
            <action.icon className="h-4 w-4 text-slate-500" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const NavigationSearchResults = ({ results, query, onLinkClick }) => (
  <div className="space-y-1" role="region" aria-label="Výsledky hledání v navigaci">
    <div className="flex items-center justify-between px-2 py-1">
      <span className="text-[10px] font-semibold uppercase text-slate-500">Výsledky</span>
      <span className="text-[11px] tabular-nums text-slate-400" aria-live="polite">{results.length}</span>
    </div>
    {results.length > 0 ? results.map(item => (
      <NavLink
        key={`${item.path}-${item.label}`}
        to={item.path}
        onClick={onLinkClick}
        className={({ isActive }) => cn(
          'group flex min-w-0 items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition',
          isActive ? 'border-blue-100 bg-blue-50 text-primary' : 'text-slate-700 hover:border-slate-200 hover:bg-slate-50'
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-white">
          <item.icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{item.label}</span>
          <span className="block truncate text-[10px] text-slate-400">
            {WORKSPACES[item.workspace]?.label || 'Portál'} · {item.parentLabel || item.groupLabel}
          </span>
        </span>
        <ChevronsRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-primary" />
      </NavLink>
    )) : (
      <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center">
        <Search className="mx-auto mb-2 h-5 w-5 text-slate-300" />
        <p className="text-xs font-semibold text-slate-600">Nic jsme nenašli</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-400">Zkuste jiný název modulu nebo stránky než „{query}“.</p>
      </div>
    )}
  </div>
);

const NavRow = ({ item, isCollapsed, isFavorite, onToggleFavorite, onLinkClick, depth = 0 }) => {
  const Icon = item.icon;
  const hasChildren = item.children?.length > 0;

  return (
    <div className={cn('group relative flex min-w-0 items-center', depth > 0 && !isCollapsed && 'ml-7')}>
      <NavLink
        to={item.path}
        end={Boolean(item.exact)}
        onClick={onLinkClick}
        title={isCollapsed ? item.label : undefined}
        className={({ isActive }) => cn(
          'relative flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold transition-all',
          isCollapsed && 'h-10 justify-center px-0',
          depth > 0 && !isCollapsed && 'py-1.5 pl-2.5 pr-8 text-xs font-medium',
          isActive
            ? 'bg-blue-50 text-primary ring-1 ring-blue-100 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-primary dark:bg-gray-800 dark:text-white dark:ring-gray-700'
            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
        )}
      >
        <Icon className={cn('shrink-0', isCollapsed ? 'h-5 w-5' : 'h-4 w-4')} />
        {!isCollapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {hasChildren && depth === 0 && <ChevronDown className="mr-5 h-4 w-4 text-slate-400" />}
          </>
        )}
      </NavLink>
      {!isCollapsed && (
        <button
          type="button"
          onClick={() => onToggleFavorite(item.path)}
          className={cn(
            'absolute right-1.5 rounded p-1 opacity-0 transition hover:bg-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100',
            isFavorite && 'opacity-100'
          )}
          title={isFavorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}
          aria-label={isFavorite ? `Odebrat ${item.label} z oblíbených` : `Přidat ${item.label} do oblíbených`}
        >
          <Star className={cn('h-3.5 w-3.5', isFavorite ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} />
        </button>
      )}
    </div>
  );
};

const NavGroup = ({ group, isCollapsed, favorites, onToggleFavorite, onLinkClick, query, hiddenPaths = [] }) => {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(!group.label || group.id === 'work' || group.id === 'business');

  const visibleItems = group.items
    .filter(item => canSeeItem(item, hasPermission))
    .filter(item => !hiddenPaths.includes(item.path))
    .map(item => ({
      ...item,
      children: (item.children || [])
        .filter(child => canSeeItem(child, hasPermission))
        .filter(child => !hiddenPaths.includes(child.path)),
    }))
    .filter(item => {
      const searchable = [item.label, group.label, ...(item.children || []).map(child => child.label)].join(' ').toLowerCase();
      return !query || searchable.includes(query.toLowerCase());
    });

  useEffect(() => {
    const containsActive = visibleItems.some(item =>
      location.pathname.startsWith(item.path) ||
      (item.children || []).some(child => location.pathname.startsWith(child.path))
    );
    if (containsActive) setOpen(true);
  }, [location.pathname, visibleItems]);

  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-1">
      {!isCollapsed && group.label && (
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          className="flex w-full items-center justify-between px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-400 hover:text-slate-700"
        >
          <span>{group.label}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {(open || isCollapsed || query) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-1 overflow-hidden"
          >
            {visibleItems.map(item => (
              <div key={item.path} className="space-y-1">
                <NavRow
                  item={item}
                  isCollapsed={isCollapsed}
                  isFavorite={favorites.includes(item.path)}
                  onToggleFavorite={onToggleFavorite}
                  onLinkClick={onLinkClick}
                />
                {!isCollapsed && item.children?.length > 0 && (
                  <div className="relative space-y-0.5 py-1 before:absolute before:left-7 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200 dark:before:bg-gray-800">
                    {item.children.map(child => (
                      <NavRow
                        key={`${child.path}-${child.label}`}
                        item={child}
                        depth={1}
                        isCollapsed={isCollapsed}
                        isFavorite={favorites.includes(child.path)}
                        onToggleFavorite={onToggleFavorite}
                        onLinkClick={onLinkClick}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SidebarShell = ({ isCollapsed = false, onLinkClick, onToggleCollapse }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, hasPermission, isPrivateMode } = useAuth();
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(loadFavorites);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const activeWorkspace = getWorkspaceFromPathname(location.pathname);
  const activeWorkspaceConfig = WORKSPACES[activeWorkspace];
  const activeNavGroups = useMemo(() => filterGroupsForWorkspace(NAV_GROUPS, activeWorkspace), [activeWorkspace]);
  const availableWorkspaces = useMemo(() => (
    Object.values(WORKSPACES).map(workspace => ({
      ...workspace,
      canAccess: canAccessWorkspace(workspace, hasPermission),
    }))
  ), [hasPermission]);
  const favoriteItems = [...new Map(ALL_NAV_ITEMS
    .filter(item => favorites.includes(item.path))
    .filter(item => canSeeItem(item, hasPermission))
    .map(item => [item.path, item])).values()];
  const showFavorites = favoriteItems.length > 0 && !query && !isCollapsed;
  const searchResults = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return [];

    return NAV_SEARCH_INDEX
      .filter(item => canSeeItem(item, hasPermission))
      .filter(item => {
        const workspace = WORKSPACES[item.workspace];
        return !workspace || canAccessWorkspace(workspace, hasPermission);
      })
      .map(item => {
        const label = normalizeSearch(item.label);
        const context = normalizeSearch([
          item.label,
          item.groupLabel,
          item.parentLabel,
          item.path.replaceAll('/', ' '),
          SEARCH_ALIASES[item.path],
          WORKSPACES[item.workspace]?.label,
        ].filter(Boolean).join(' '));
        const score = label === normalizedQuery ? 0 : label.startsWith(normalizedQuery) ? 1 : context.includes(normalizedQuery) ? 2 : 9;
        return { ...item, score };
      })
      .filter(item => item.score < 9)
      .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label, 'cs'))
      .slice(0, 12);
  }, [hasPermission, query]);
  const hiddenFavoritePaths = showFavorites
    ? favoriteItems
      .filter(item => belongsToWorkspace(item, activeWorkspace))
      .filter(item => !item.children?.length)
      .map(item => item.path)
    : [];

  useEffect(() => {
    setQuery('');
  }, [location.pathname]);

  const toggleFavorite = (path) => {
    setFavorites(current => (
      current.includes(path)
        ? current.filter(itemPath => itemPath !== path)
        : [...current, path]
    ));
  };

  const handleLogout = async () => {
    onLinkClick?.();
    await signOut();
    navigate('/login');
  };

  const handleWorkspaceNavigate = (workspace) => {
    if (!workspace.canAccess) return;
    onLinkClick?.();
    navigate(workspace.path);
  };

  const otherWorkspace = availableWorkspaces.find(workspace => workspace.id !== activeWorkspace && workspace.canAccess);

  return (
    <div className={cn(
      'flex h-full min-h-0 flex-col border-r border-slate-200/90 bg-white px-2.5 py-3 shadow-[1px_0_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-950',
      isCollapsed && 'items-center'
    )}>
      <div className={cn('mb-4 flex items-center gap-2 px-1', isCollapsed ? 'flex-col justify-center' : 'justify-between')}>
        <div className={cn(
          'relative flex items-center rounded-lg dark:bg-gray-900',
          isCollapsed ? 'h-10 w-10 justify-center bg-slate-50 ring-1 ring-slate-200/90' : 'min-w-0 gap-2 py-1'
        )}>
          <img src="/favicon.svg" alt="EKV" className={cn('w-auto', isCollapsed ? 'h-7' : 'h-8')} />
          {!isCollapsed && (
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-5 text-slate-950">EKV {activeWorkspaceConfig.title}</span>
              <span className="block truncate text-[10px] font-medium text-slate-400">Pracovní prostředí</span>
            </span>
          )}
          <div className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white dark:border-gray-900', isPrivateMode ? 'bg-red-500' : 'bg-green-500')} />
        </div>

        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-md bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-950 hover:shadow-md"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Zobrazit menu' : 'Skrýt menu'}
            title={isCollapsed ? 'Zobrazit menu' : 'Skrýt menu'}
          >
            {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {!isCollapsed && <div className="mb-3 border-b border-slate-200/80 dark:border-gray-800" />}

      <div className={cn('mb-3', isCollapsed && 'w-full')}>
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => otherWorkspace && handleWorkspaceNavigate(otherWorkspace)}
            disabled={!otherWorkspace}
            className="flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title={otherWorkspace ? `Přepnout na ${otherWorkspace.label}` : 'Žádná další dostupná zóna'}
            aria-label={otherWorkspace ? `Přepnout na ${otherWorkspace.label}` : 'Žádná další dostupná zóna'}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-1 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
            <div className="grid grid-cols-2 gap-1">
              {availableWorkspaces.map(workspace => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleWorkspaceNavigate(workspace)}
                  disabled={!workspace.canAccess}
                  className={cn(
                    'rounded px-2 py-2 text-xs font-semibold transition',
                    workspace.id === activeWorkspace
                      ? 'bg-white text-primary shadow-sm ring-1 ring-slate-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700'
                      : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800'
                  )}
                >
                  {workspace.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <SearchBox value={query} onChange={setQuery} isCollapsed={isCollapsed} />

      <QuickActions isCollapsed={isCollapsed} onLinkClick={onLinkClick} workspace={activeWorkspace} />

      <nav className={cn('min-h-0 flex-1 overflow-y-auto', isCollapsed ? 'w-full space-y-2' : 'space-y-2 pr-1')}>
        {query && !isCollapsed ? (
          <NavigationSearchResults results={searchResults} query={query} onLinkClick={onLinkClick} />
        ) : (
          <>
        {showFavorites && (
          <div className="space-y-1 rounded-md border border-slate-200/80 bg-slate-50/70 p-1.5 dark:border-gray-800 dark:bg-gray-900/60">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-normal text-slate-500">
              Oblíbené
            </div>
            {favoriteItems.map(item => (
              <NavRow
                key={`favorite-${item.path}`}
                item={item}
                isCollapsed={isCollapsed}
                isFavorite
                onToggleFavorite={toggleFavorite}
                onLinkClick={onLinkClick}
              />
            ))}
          </div>
        )}

        {activeNavGroups.map(group => (
          <NavGroup
            key={group.id}
            group={group}
            isCollapsed={isCollapsed}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onLinkClick={onLinkClick}
            query=""
            hiddenPaths={hiddenFavoritePaths}
          />
        ))}
          </>
        )}
      </nav>

      <div className={cn('mt-3 space-y-2 border-t border-slate-200 px-1 pt-3 dark:border-gray-800', isCollapsed && 'w-full px-0')}>
        <UserProfile isCollapsed={isCollapsed} />
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-900/20',
            isCollapsed && 'h-10 justify-center px-0'
          )}
          title={isCollapsed ? 'Odhlásit se' : undefined}
          aria-label="Odhlásit se"
        >
          <LogOut className={cn('shrink-0', isCollapsed ? 'h-5 w-5' : 'h-4 w-4')} />
          {!isCollapsed && <span>Odhlásit se</span>}
        </button>
        {!isCollapsed && (
          <div className="pt-3 text-[11px] leading-5 text-slate-400">
            <div>© 2026 EKV - Project s.r.o.</div>
            <div>v2.0.0</div>
          </div>
        )}
      </div>
    </div>
  );
};

const DesktopSidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true');

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(isCollapsed));
    document.documentElement.style.setProperty('--sidebar-width', isCollapsed ? '4.5rem' : '16rem');
    return () => document.documentElement.style.removeProperty('--sidebar-width');
  }, [isCollapsed]);

  return (
    <motion.aside
      initial={{ x: -280 }}
      animate={{ x: 0 }}
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-full flex-col transition-all duration-300 print:hidden lg:flex',
        isCollapsed ? 'w-[4.5rem]' : 'w-[16rem]'
      )}
    >
      <SidebarShell isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(current => !current)} />
    </motion.aside>
  );
};

const MobileSidebar = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed left-4 top-4 z-50 print:hidden lg:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="bg-white shadow-md" aria-label="Otevřít menu">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
          <SheetContent side="left" className="w-[336px] max-w-[calc(100vw-1rem)] border-r-0 p-0">
          <SheetTitle className="sr-only">Navigace portálu</SheetTitle>
          <SheetDescription className="sr-only">Hlavní menu modulů, oblíbených položek a správy portálu.</SheetDescription>
          <SidebarShell onLinkClick={() => setIsOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
};

const Sidebar = () => (
  <>
    <DesktopSidebar />
    <MobileSidebar />
  </>
);

export default Sidebar;
