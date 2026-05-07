import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Home, Folder, FileText, Users, DollarSign, BarChart, Settings, LogOut, 
  ListTodo, UserCog, ChevronsRight, ChevronsLeft, Wrench, Clock, Menu, 
  Building, Shield, Search, Moon, Sun, Plus, ClipboardList, Briefcase, X, FilePieChart, HardHat, EyeOff, Copy, Contact
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const DarkModeContext = React.createContext();

const DarkModeProvider = ({ children }) => {
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('darkMode');
        return saved ? JSON.parse(saved) : false;
    });

    useEffect(() => {
        localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [isDarkMode]);

    return (
        <DarkModeContext.Provider value={{ isDarkMode, setIsDarkMode }}>
            {children}
        </DarkModeContext.Provider>
    );
};

const useDarkMode = () => {
    const context = React.useContext(DarkModeContext);
    if (!context) {
        throw new Error('useDarkMode must be used within DarkModeProvider');
    }
    return context;
};

// Centralized Navigation Configuration
const NAV_ITEMS = [
    { icon: Home, label: 'Přehled', path: '/dashboard', module: 'dashboard', badge: null, category: 'Hlavní' },
    { icon: Folder, label: 'Projekce', path: '/projects', module: 'projects', badge: null, category: 'Hlavní' },
    { icon: HardHat, label: 'Realizace', path: '/realizace', module: 'realizace', badge: null, category: 'Hlavní' },
    { icon: ListTodo, label: 'Úkoly', path: '/tasks', module: 'tasks', badge: null, category: 'Projekty' },
    { icon: Copy, label: 'Šablony projektů', path: '/templates', module: 'projects', badge: null, category: 'Projekty' },
    { icon: Clock, label: 'Docházka', path: '/attendance', module: 'attendance', badge: null, category: 'Správa' },
    { icon: FileText, label: 'Dokumenty', path: '/documents', module: 'documents', badge: null, category: 'Správa' },
    { icon: Contact, label: 'CRM', path: '/crm', module: 'crm', badge: null, category: 'Správa' },
    { icon: Building, label: 'Subjekty', path: '/subjects', module: 'subjects', badge: null, category: 'Správa' },
    { icon: Wrench, label: 'Inženýring', path: '/engineering', module: 'engineering', badge: null, category: 'Správa' },
    { icon: Users, label: 'Zaměstnanci', path: '/members', module: 'members', badge: null, category: 'Správa' },
    { icon: DollarSign, label: 'Výplaty', path: '/payouts', module: 'payouts', badge: null, category: 'Finance' },
    { icon: FilePieChart, label: 'Režijní náklady', path: '/overhead-costs', module: 'finance', badge: null, category: 'Finance' },
    { icon: BarChart, label: 'Reporty', path: '/reports', module: 'reports', badge: null, category: 'Reporty' },
];

const UserProfile = React.memo(({ isCollapsed }) => {
    const { user, isPrivateMode, togglePrivateMode, isAdmin } = useAuth();
    const { isDarkMode, setIsDarkMode } = useDarkMode();
    const [isPrivateDialogOpen, setIsPrivateDialogOpen] = useState(false);

    if (!user) return null;

    const fullName = user.user_metadata?.full_name || 'Uživatel';
    const email = user.email;
    const avatarUrl = user.user_metadata?.avatar_url;
    const fallback = fullName.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';

    const handlePrivateToggle = () => {
        if (isPrivateMode) {
            togglePrivateMode(false);
        } else {
            setIsPrivateDialogOpen(true);
        }
    };

    const confirmPrivateMode = () => {
        togglePrivateMode(true);
        setIsPrivateDialogOpen(false);
    }

    return (
        <>
        <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "flex items-center gap-2 p-2 rounded-lg transition-all mb-3 group hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700",
                isCollapsed ? 'justify-center' : 'bg-white dark:bg-gray-800'
            )}
        >
            <div className="relative">
                <Avatar className="h-8 w-8 ring-1 ring-white dark:ring-gray-800 shadow-sm">
                    <AvatarImage src={avatarUrl} alt={fullName} loading="lazy" />
                    <AvatarFallback className="bg-gray-700 dark:bg-gray-600 text-white font-semibold text-xs">
                        {fallback}
                    </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 border border-white dark:border-gray-800 rounded-full"></div>
            </div>
            <AnimatePresence>
                {!isCollapsed && (
                    <motion.div 
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        className="flex flex-col overflow-hidden flex-1"
                    >
                        <span className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate">{fullName}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{email}</span>
                        <div className="flex items-center justify-between mt-0.5 gap-1">
                            <Badge variant={isPrivateMode ? "destructive" : "success"} className="text-[10px] px-1.5 py-0 h-4 truncate max-w-[80px]">
                                {isPrivateMode ? <><EyeOff className="w-2 h-2 mr-0.5" /> Privátní</> : <><Shield className="w-2 h-2 mr-0.5" /> Aktivní</>}
                            </Badge>
                            
                            <div className="flex items-center gap-1">
                                {isAdmin && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handlePrivateToggle}
                                        title={isPrivateMode ? "Vypnout privátní mód" : "Zapnout privátní mód"}
                                        className={cn("h-5 w-5 p-0", isPrivateMode ? "text-red-500 hover:bg-red-50" : "hover:bg-gray-200 dark:hover:bg-gray-700")}
                                    >
                                        <EyeOff className="w-3 h-3" />
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsDarkMode(!isDarkMode)}
                                    className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                                >
                                    {isDarkMode ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>

        <AlertDialog open={isPrivateDialogOpen} onOpenChange={setIsPrivateDialogOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Aktivovat privátní mód?</AlertDialogTitle>
                    <AlertDialogDescription>
                        V privátním módu budou <strong>skryty všechny finanční údaje</strong> (ceny, náklady, mzdy, zisk) napříč celou aplikací.
                        <br/><br/>
                        Tento režim je vhodný pro prezentaci systému třetím stranám nebo práci na veřejnosti.
                        Režim můžete kdykoliv vypnout v panelu uživatele.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmPrivateMode}>Aktivovat</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    )
});

const SearchBar = ({ isCollapsed, searchQuery, setSearchQuery }) => {
    if (isCollapsed) return null;
    
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2"
        >
            <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <input
                    type="text"
                    placeholder="Vyhledat..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-7 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>
        </motion.div>
    );
};

const QuickActions = ({ isCollapsed, onLinkClick }) => {
    const navigate = useNavigate();
    
    const quickActions = [
        { icon: Plus, label: 'Nový projekt', path: '/projects/new', color: 'text-blue-600' },
        { icon: ClipboardList, label: 'Nový úkol', path: '/tasks', color: 'text-green-600' },
        { icon: Briefcase, label: 'Nový dokument', path: '/documents', color: 'text-purple-600' },
    ];

    if (isCollapsed) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2"
        >
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-2">
                Rychlé akce
            </h3>
            <div className="space-y-0.5">
                {quickActions.map((action, index) => (
                    <motion.button
                        key={action.label}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => {
                            navigate(action.path);
                            if (onLinkClick) onLinkClick();
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <action.icon className={`w-3 h-3 ${action.color}`} />
                        <span className="truncate">{action.label}</span>
                    </motion.button>
                ))}
            </div>
        </motion.div>
    );
};

const NavItem = ({ icon: Icon, label, path, onClick, module, badge, isCollapsed, category }) => {
    const { hasPermission } = useAuth();
    
    if (!hasPermission(module, 'can_read')) {
        return null;
    }

    return (
        <NavLink
          to={path}
          onClick={onClick}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-2 px-2 py-2 rounded-lg transition-all duration-200 text-xs font-medium relative",
              isCollapsed ? 'justify-center' : '',
              isActive
                ? 'bg-gray-900 dark:bg-gray-700 text-white dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
            )
          }
        >
          <div className="relative">
            <Icon className={cn(
              "w-4 h-4 shrink-0 transition-all duration-200",
              "group-hover:scale-105"
            )} />
            {badge && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
                  {badge}
              </span>
            )}
          </div>
          <AnimatePresence>
            {!isCollapsed && (
              <motion.span 
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="truncate"
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </NavLink>
    );
};

const SidebarContent = ({ onLinkClick }) => {
  const navigate = useNavigate();
  const { signOut, hasPermission, isPrivateMode } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredItems = NAV_ITEMS.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedItems = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});

  const handleLogout = async () => {
    if(onLinkClick) onLinkClick();
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 p-3">
        <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center mb-3 pt-2"
        >
            <div className="relative">
                <img 
                    src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/2f93fb620df7a7540852c9ec9f499aee.png" 
                    alt="EKV Group Logo" 
                    className="h-8 w-auto" 
                    loading="lazy"
                />
                <div className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 border border-white dark:border-gray-900 rounded-full", isPrivateMode ? "bg-red-500" : "bg-green-500")}></div>
            </div>
        </motion.div>
        
        <UserProfile isCollapsed={false} />
        <SearchBar isCollapsed={false} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        <QuickActions isCollapsed={false} onLinkClick={onLinkClick} />

        <nav className="flex-grow space-y-0.5 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="space-y-2"
            >
                {Object.entries(groupedItems).map(([category, items], categoryIndex) => (
                    <div key={category}>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-2">
                            {category}
                        </h3>
                        <div className="space-y-0.5">
                            {items.map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.1 + (categoryIndex * 0.1) + (index * 0.05) }}
                                >
                                    <NavItem {...item} onClick={onLinkClick} isCollapsed={false} />
                                </motion.div>
                            ))}
                        </div>
                    </div>
                ))}
            </motion.div>
        </nav>

        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-1 mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"
        >
            {hasPermission('settings', 'can_read') && (
                <NavItem icon={Settings} label="Nastavení" path="/settings" module="settings" onClick={onLinkClick} isCollapsed={false} />
            )}
            {hasPermission('settings', 'can_admin') && (
                <NavItem icon={UserCog} label="Správa uživatelů" path="/settings/users" module="settings" onClick={onLinkClick} isCollapsed={false} />
            )}
            
            <motion.button 
                onClick={handleLogout} 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className='w-full flex items-center gap-2 px-2 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 text-xs font-medium transition-all duration-200 group'
            >
                <LogOut className="w-4 h-4 shrink-0 group-hover:scale-105 transition-transform" />
                <span>Odhlásit se</span>
            </motion.button>
        </motion.div>
    </div>
  );
}

const DesktopSidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { signOut, hasPermission, isPrivateMode } = useAuth();
  
  const filteredItems = NAV_ITEMS.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedItems = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
      <motion.aside 
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        className={cn(
          "fixed top-0 left-0 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex-col p-3 shadow-sm transition-all duration-300 z-40 hidden lg:flex print:hidden",
          isCollapsed ? "w-16" : "w-56"
        )}
      >
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center mb-3"
        >
          <div className="relative">
            <img 
              src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/2f93fb620df7a7540852c9ec9f499aee.png" 
              alt="EKV Group Logo" 
              className={cn("w-auto transition-all duration-300", isCollapsed ? "h-6" : "h-8")} 
              loading="lazy"
            />
            <div className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 border border-white dark:border-gray-900 rounded-full", isPrivateMode ? "bg-red-500" : "bg-green-500")}></div>
          </div>
        </motion.div>
        
        <UserProfile isCollapsed={isCollapsed} />
        <SearchBar isCollapsed={isCollapsed} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        <QuickActions isCollapsed={isCollapsed} onLinkClick={() => {}} />

        <nav className="flex-grow space-y-0.5 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            {Object.entries(groupedItems).map(([category, items], categoryIndex) => (
              <div key={category}>
                {!isCollapsed && (
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-2">
                    {category}
                  </h3>
                )}
                <div className="space-y-0.5">
                  {items.map((item, index) => (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + (categoryIndex * 0.1) + (index * 0.05) }}
                    >
                      <NavItem {...item} isCollapsed={isCollapsed} />
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        </nav>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-1 mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"
        >
          {hasPermission('settings', 'can_read') && (
            <NavItem icon={Settings} label="Nastavení" path="/settings" module="settings" isCollapsed={isCollapsed} />
          )}
          {hasPermission('settings', 'can_admin') && (
            <NavItem icon={UserCog} label="Správa uživatelů" path="/settings/users" module="settings" isCollapsed={isCollapsed} />
          )}
          
          <motion.button 
            onClick={handleLogout} 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 text-xs font-medium transition-all duration-200 group',
              isCollapsed ? 'justify-center' : ''
            )}
            title={isCollapsed ? 'Odhlásit se' : undefined}
          >
            <LogOut className="w-4 h-4 shrink-0 group-hover:scale-105 transition-transform" />
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span 
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                >
                  Odhlásit se
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"
        >
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button 
              variant="ghost" 
              size="icon" 
              className="w-full flex justify-center hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300" 
              onClick={() => setIsCollapsed(!isCollapsed)}
            >
              {isCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
            </Button>
          </motion.div>
        </motion.div>
      </motion.aside>
  );
};

const MobileSidebar = () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="lg:hidden fixed top-4 left-4 z-50 print:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <motion.div
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Button 
                            variant="outline" 
                            size="icon" 
                            className="bg-white shadow-md border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                        >
                            <Menu className="h-5 w-5" />
                        </Button>
                    </motion.div>
                </SheetTrigger>
                <SheetContent 
                    side="left" 
                    className="p-0 w-[300px] border-r-0 bg-white"
                >
                    <SidebarContent onLinkClick={() => setIsOpen(false)} />
                </SheetContent>
            </Sheet>
        </div>
    );
};

const Sidebar = () => {
  return (
    <DarkModeProvider>
        <DesktopSidebar />
        <MobileSidebar />
    </DarkModeProvider>
  );
};

export default Sidebar;
