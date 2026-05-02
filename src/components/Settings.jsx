import React from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { Settings as SettingsIcon, Users, Key, ShoppingCart, User, BookOpen, FileText, Database } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';

const settingsNav = [
  { name: 'Můj profil', href: '/settings/profile', icon: User, requiredPermission: 'can_read' },
  { name: 'Uživatelé', href: '/settings/users', icon: Users, requiredPermission: 'can_admin' },
  { name: 'Oprávnění', href: '/settings/permissions', icon: Key, requiredPermission: 'can_admin' },
  { name: 'Šablony projektů', href: '/settings/project-templates', icon: FileText, requiredPermission: 'can_admin' },
  { name: 'Šablony objednávek', href: '/settings/order-templates', icon: ShoppingCart, requiredPermission: 'can_admin' },
  { name: 'Číselníky', href: '/settings/dictionaries', icon: BookOpen, requiredPermission: 'can_admin' },
  { name: 'Zálohování a údržba', href: '/settings/backup-maintenance', icon: Database, requiredPermission: 'can_admin' },
];

const Settings = () => {
  const location = useLocation();
  const { hasPermission } = useAuth();
  const isRootSettings = location.pathname === '/settings';

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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-3 xl:col-span-2">
          <nav className="flex flex-col space-y-1">
            {settingsNav
              .filter(item => hasPermission('settings', item.requiredPermission))
              .map((item) => (
                <NavLink
                  key={item.name}
                  to={item.href}
                  end={item.href === '/settings'}
                  className={({ isActive }) => {
                    const realIsActive = (isRootSettings && item.href === '/settings/profile') || isActive;
                    return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${realIsActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/50'
                      }`;
                  }}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </NavLink>
              ))}
          </nav>
        </aside>

        <main className="lg:col-span-9 xl:col-span-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Settings;
