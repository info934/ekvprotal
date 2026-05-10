import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart,
  Briefcase,
  Building,
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
  Moon,
  Package,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  Sun,
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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';

const FAVORITES_KEY = 'ekv-sidebar-favorites';
const DEFAULT_FAVORITES = ['/dashboard', '/projects', '/realizace'];

const DarkModeContext = React.createContext();

const DarkModeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  return (
    <DarkModeContext.Provider value={{ isDarkMode, setIsDarkMode }}>
      {children}
    </DarkModeContext.Provider>
  );
};

const useDarkMode = () => {
  const context = React.useContext(DarkModeContext);
  if (!context) throw new Error('useDarkMode must be used within DarkModeProvider');
  return context;
};

const NAV_GROUPS = [
  {
    id: 'primary',
    label: null,
    items: [
      { icon: Home, label: 'Přehled', path: '/dashboard', module: 'dashboard' },
      { icon: Folder, label: 'Projekce', path: '/projects', module: 'projects' },
      { icon: HardHat, label: 'Realizace', path: '/realizace', module: 'realizace' },
      {
        icon: Contact,
        label: 'CRM',
        path: '/crm',
        module: 'crm',
        children: [
          { icon: BarChart, label: 'Obchodní nástěnka', path: '/crm', module: 'crm' },
          { icon: Target, label: 'Obchodní případy', path: '/crm/opportunities', module: 'crm' },
          { icon: FileText, label: 'Nabídky', path: '/crm/offers', module: 'crm' },
          { icon: ClipboardList, label: 'Objednávky', path: '/crm/orders', module: 'crm' },
          { icon: Building, label: 'Subjekty', path: '/subjects', module: 'subjects' },
        ],
      },
      {
        icon: DollarSign,
        label: 'Finance',
        path: '/reports',
        module: 'reports',
        children: [
          { icon: DollarSign, label: 'Výplaty', path: '/payouts', module: 'payouts' },
          { icon: FilePieChart, label: 'Režijní náklady', path: '/overhead-costs', module: 'finance' },
          { icon: BarChart, label: 'Reporty', path: '/reports', module: 'reports' },
        ],
      },
      { icon: Package, label: 'Produkty', path: '/products', module: 'crm' },
      { icon: Wrench, label: 'Inženýring', path: '/engineering', module: 'engineering' },
      { icon: Clock, label: 'Docházka', path: '/attendance', module: 'attendance' },
      { icon: ListTodo, label: 'Úkoly', path: '/tasks', module: 'tasks' },
      { icon: Users, label: 'Zaměstnanci', path: '/members', module: 'members' },
      { icon: Copy, label: 'Šablony projektu', path: '/templates', module: 'projects' },
      { icon: FileText, label: 'Dokumenty', path: '/documents', module: 'documents' },
      { icon: UserCog, label: 'Správa uživatelů', path: '/settings/users', module: 'settings', level: 'can_admin' },
      { icon: Settings, label: 'Nastavení', path: '/settings', module: 'settings' },
    ],
  },
];

const QUICK_ACTIONS = [
  { icon: Plus, label: 'Nový projekt', path: '/projects/new', module: 'projects', level: 'can_edit' },
  { icon: Briefcase, label: 'Nová realizace', path: '/realizace/new', module: 'realizace', level: 'can_edit' },
  { icon: ClipboardList, label: 'Nový úkol', path: '/tasks', module: 'tasks', level: 'can_edit' },
];

const flattenItems = (groups) => groups.flatMap(group =>
  group.items.flatMap(item => [item, ...(item.children || [])])
);

const canSeeItem = (item, hasPermission) => hasPermission(item.module, item.level || 'can_read');

const UserProfile = React.memo(({ isCollapsed }) => {
  const { user, isPrivateMode, togglePrivateMode, isAdmin } = useAuth();
  const { isDarkMode, setIsDarkMode } = useDarkMode();
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
                <div className="flex items-center gap-1">
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={handlePrivateToggle} className="h-6 w-6" title="Privátní režim">
                      <EyeOff className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setIsDarkMode(!isDarkMode)} className="h-6 w-6" title="Přepnout vzhled">
                    {isDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  </Button>
                </div>
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
    <div className="mb-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Hledat modul..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-100"
        />
        {value && (
          <button type="button" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

const QuickActions = ({ isCollapsed, onLinkClick }) => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const visibleActions = QUICK_ACTIONS.filter(action => canSeeItem(action, hasPermission));

  if (isCollapsed || visibleActions.length === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-3 gap-1.5">
      {visibleActions.map(action => (
        <button
          key={action.path}
          type="button"
          onClick={() => {
            navigate(action.path);
            onLinkClick?.();
          }}
          className="flex min-w-0 flex-col items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-2 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:border-primary/30 hover:bg-blue-50/50 hover:text-primary hover:shadow-md"
          title={action.label}
        >
          <action.icon className="h-4 w-4" />
          <span className="max-w-full truncate">{action.label.replace('Nový ', '').replace('Nová ', '')}</span>
        </button>
      ))}
    </div>
  );
};

const NavRow = ({ item, isCollapsed, isFavorite, onToggleFavorite, onLinkClick, depth = 0 }) => {
  const Icon = item.icon;
  const hasChildren = item.children?.length > 0;

  return (
    <NavLink
      to={item.path}
      end={item.path === '/crm' && depth > 0}
      onClick={onLinkClick}
      title={isCollapsed ? item.label : undefined}
      className={({ isActive }) => cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all',
        isCollapsed && 'h-10 justify-center px-0',
        depth > 0 && !isCollapsed && 'ml-8 py-2 pl-3 text-xs font-medium',
        isActive
          ? 'bg-blue-50 text-primary ring-1 ring-blue-100 dark:bg-gray-800 dark:text-white dark:ring-gray-700'
          : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
      )}
    >
      <Icon className={cn('shrink-0', isCollapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!isCollapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {hasChildren && depth === 0 && <ChevronDown className="h-4 w-4 text-slate-400" />}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite(item.path);
            }}
            className={cn('rounded p-0.5 opacity-0 transition group-hover:opacity-100', isFavorite && 'opacity-100', hasChildren && depth === 0 && 'hidden')}
            title={isFavorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}
          >
            <Star className={cn('h-3.5 w-3.5', isFavorite ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} />
          </button>
        </>
      )}
    </NavLink>
  );
};

const NavGroup = ({ group, isCollapsed, favorites, onToggleFavorite, onLinkClick, query, hiddenPaths = [] }) => {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(true);

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
    <div className="space-y-1.5">
      {!isCollapsed && group.label && (
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-normal text-slate-500 hover:text-slate-700"
        >
          <span>{group.label}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {(open || isCollapsed) && (
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
  const { signOut, hasPermission, isPrivateMode } = useAuth();
  const [query] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || DEFAULT_FAVORITES;
    } catch {
      return DEFAULT_FAVORITES;
    }
  });

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const allItems = useMemo(() => flattenItems(NAV_GROUPS), []);
  const favoriteItems = allItems
    .filter(item => favorites.includes(item.path))
    .filter(item => canSeeItem(item, hasPermission));
  const hiddenFavoritePaths = [];

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
          <img
            src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/2f93fb620df7a7540852c9ec9f499aee.png"
            alt="EKV Group Logo"
            className={cn('w-auto', isCollapsed ? 'h-6' : 'h-7')}
            loading="lazy"
          />
          {!isCollapsed && <span className="text-xl font-semibold tracking-tight text-slate-950">Portal</span>}
          <div className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white dark:border-gray-900', isPrivateMode ? 'bg-red-500' : 'bg-green-500')} />
        </div>

        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-md bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-950 hover:shadow-md"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Zobrazit menu' : 'Skrýt menu'}
          >
            {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {!isCollapsed && <div className="mb-3 border-b border-slate-200/80 dark:border-gray-800" />}

      <nav className={cn('min-h-0 flex-1 overflow-y-auto', isCollapsed ? 'w-full space-y-2' : 'space-y-2 pr-1')}>
        {false && favoriteItems.length > 0 && !query && !isCollapsed && (
          <div className="space-y-1">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-normal text-slate-500">
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

        {NAV_GROUPS.map(group => (
          <NavGroup
            key={group.id}
            group={group}
            isCollapsed={isCollapsed}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onLinkClick={onLinkClick}
            query={query}
            hiddenPaths={hiddenFavoritePaths}
          />
        ))}
      </nav>

      <div className={cn('mt-3 space-y-2 border-t border-slate-200 px-1 pt-3 dark:border-gray-800', isCollapsed && 'w-full px-0')}>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900',
              isCollapsed && 'h-10 justify-center px-0'
            )}
            title={isCollapsed ? 'Zobrazit menu' : undefined}
          >
            {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!isCollapsed && <span>Sbalit menu</span>}
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-900/20',
            isCollapsed && 'h-10 justify-center px-0'
          )}
          title={isCollapsed ? 'Odhlásit se' : undefined}
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
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', isCollapsed ? '4.5rem' : '15rem');
    return () => document.documentElement.style.removeProperty('--sidebar-width');
  }, [isCollapsed]);

  return (
    <motion.aside
      initial={{ x: -280 }}
      animate={{ x: 0 }}
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-full flex-col transition-all duration-300 print:hidden lg:flex',
        isCollapsed ? 'w-[4.5rem]' : 'w-[15rem]'
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
          <Button variant="outline" size="icon" className="bg-white shadow-md">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[320px] max-w-[calc(100vw-1rem)] border-r-0 p-0">
          <SidebarShell onLinkClick={() => setIsOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
};

const Sidebar = () => (
  <DarkModeProvider>
    <DesktopSidebar />
    <MobileSidebar />
  </DarkModeProvider>
);

export default Sidebar;
