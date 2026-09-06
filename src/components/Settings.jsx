import React from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  Users,
  Key,
  ShoppingCart,
  User,
  BookOpen,
  FileText,
  Database,
  ChevronRight,
  SlidersHorizontal,
  Cloud,
  Target,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

const settingsNav = [
  {
    label: 'Účet',
    items: [
      { name: 'Můj profil', description: 'Osobní údaje a zabezpečení', href: '/settings/profile', icon: User, requiredPermission: 'can_read' },
    ],
  },
  {
    label: 'Přístupy',
    items: [
      { name: 'Uživatelé', description: 'Účty a přístupové role', href: '/settings/users', icon: Users, requiredPermission: 'can_admin' },
      { name: 'Přístupové role', description: 'Práva účtů k modulům aplikace', href: '/settings/permissions', icon: Key, requiredPermission: 'can_admin' },
    ],
  },
  {
    label: 'Konfigurace',
    items: [
      { name: 'Číselníky', description: 'Centrální hodnoty pro formuláře', href: '/settings/dictionaries', icon: BookOpen, requiredPermission: 'can_admin' },
      { name: 'Šablony projektu', description: 'Výchozí struktury projektu', href: '/settings/project-templates', icon: FileText, requiredPermission: 'can_admin' },
      { name: 'Šablony dokumentů', description: 'HTML a DOCX šablony výstupů', href: '/settings/order-templates', icon: ShoppingCart, requiredPermission: 'can_admin' },
      { name: 'CRM', description: 'Stavy, priority, šablony a číslování', href: '/settings/crm', icon: Target, requiredPermission: 'can_admin' },
      { name: 'Servis a SLA', description: 'Reakční a cílové lhůty podle priority', href: '/settings/service', icon: Wrench, requiredPermission: 'can_admin' },
      { name: 'Úložiště dokumentů', description: 'Supabase, SharePoint nebo Google Drive', href: '/settings/storage', icon: Cloud, requiredPermission: 'can_admin' },
    ],
  },
  {
    label: 'Systém',
    items: [
      { name: 'Nastavení portálu', description: 'Globální hodnoty aplikace', href: '/settings/portal', icon: SlidersHorizontal, requiredPermission: 'can_admin' },
      { name: 'Zálohování a údržba', description: 'Servisní operace portálu', href: '/settings/backup-maintenance', icon: Database, requiredPermission: 'can_admin' },
    ],
  },
];

const Settings = () => {
  const location = useLocation();
  const { hasPermission } = useAuth();
  const isRootSettings = location.pathname === '/settings';
  const visibleGroups = settingsNav
    .map(group => ({
      ...group,
      items: group.items.filter(item => hasPermission('settings', item.requiredPermission)),
    }))
    .filter(group => group.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="Nastavení"
        description="Správa profilu, oprávnění, šablon a systémových nastavení."
      />
      <header className="hidden">
        <SettingsIcon className="w-8 h-8" />
        <h1 className="text-3xl font-bold">Nastavení</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className={cn('lg:order-1 lg:col-span-4 xl:col-span-3', isRootSettings ? 'order-1' : 'order-2')}>
          <nav className="app-surface sticky top-4 space-y-5 p-3">
            {visibleGroups.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      end={item.href === '/settings'}
                      className={({ isActive }) => {
                        const realIsActive = (isRootSettings && item.href === '/settings/profile') || isActive;
                        return cn(
                          'group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors',
                          realIsActive
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-slate-700 hover:bg-slate-100'
                        );
                      }}
                    >
                      {({ isActive }) => {
                        const realIsActive = (isRootSettings && item.href === '/settings/profile') || isActive;
                        return (
                          <>
                            <span className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                              realIsActive ? 'bg-white/15' : 'bg-slate-100 text-slate-600 group-hover:bg-white'
                            )}>
                              <item.icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold leading-5">{item.name}</span>
                              <span className={cn(
                                'block truncate text-xs leading-4',
                                realIsActive ? 'text-primary-foreground/75' : 'text-muted-foreground'
                              )}>
                                {item.description}
                              </span>
                            </span>
                            <ChevronRight className={cn(
                              'h-4 w-4 shrink-0',
                              realIsActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                            )} />
                          </>
                        );
                      }}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className={cn('min-w-0 lg:order-2 lg:col-span-8 xl:col-span-9', isRootSettings ? 'order-2' : 'order-1')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Settings;
