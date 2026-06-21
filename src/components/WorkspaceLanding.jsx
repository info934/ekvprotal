import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  ClipboardList,
  FolderKanban,
  HardHat,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { WORKSPACES, canAccessWorkspace } from '@/lib/workspaces';
import { cn } from '@/lib/utils';

const workspaceCards = [
  {
    ...WORKSPACES.crm,
    icon: Briefcase,
    accent: 'border-blue-200 bg-blue-50 text-blue-700',
    features: [
      { icon: Users, label: 'Subjekty a kontakty' },
      { icon: ClipboardList, label: 'Nabídky a objednávky' },
      { icon: BarChart3, label: 'Obchodní pipeline' },
    ],
  },
  {
    ...WORKSPACES.portal,
    icon: LayoutDashboard,
    accent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    features: [
      { icon: FolderKanban, label: 'Projekce' },
      { icon: HardHat, label: 'Realizace' },
      { icon: Settings, label: 'Provoz a finance' },
    ],
  },
];

const WorkspaceCard = ({ workspace, disabled }) => {
  const Icon = workspace.icon;

  return (
    <div className={cn(
      'flex h-full flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition',
      disabled ? 'opacity-60' : 'hover:border-primary/30 hover:shadow-md'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-md border', workspace.accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
          {disabled ? 'Bez oprávnění' : 'Dostupné'}
        </span>
      </div>

      <div className="mt-5 min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">{workspace.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{workspace.description}</p>
      </div>

      <div className="mt-5 grid gap-2">
        {workspace.features.map(feature => (
          <div key={feature.label} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            <feature.icon className="h-4 w-4 text-slate-500" />
            <span className="min-w-0 truncate">{feature.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-6">
        <Button asChild={!disabled} disabled={disabled} className="w-full justify-between rounded-md">
          {disabled ? (
            <span>Otevřít {workspace.label}</span>
          ) : (
            <Link to={workspace.path}>
              Otevřít {workspace.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
};

const WorkspaceLanding = () => {
  const { hasPermission } = useAuth();
  const visibleCards = workspaceCards.map(workspace => ({
    ...workspace,
    disabled: !canAccessWorkspace(workspace, hasPermission),
  }));
  const hasAnyWorkspace = visibleCards.some(card => !card.disabled);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <img
                src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/2f93fb620df7a7540852c9ec9f499aee.png"
                alt="EKV Group Logo"
                className="h-8 w-auto"
                loading="lazy"
              />
              <div>
                <p className="text-sm font-semibold uppercase tracking-normal text-slate-500">EKV Group</p>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Rozcestník</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              Vyberte pracovní zónu. CRM a Portal sdílí stejná data, oprávnění a vazby mezi obchodem, projekcí a realizací.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
            <Building2 className="h-4 w-4 text-primary" />
            Jedna propojená aplikace
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {visibleCards.map(workspace => (
            <WorkspaceCard key={workspace.id} workspace={workspace} disabled={workspace.disabled} />
          ))}
        </div>

        {!hasAnyWorkspace && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Pro tento účet nejsou dostupné žádné pracovní zóny. Kontaktujte správce portálu kvůli nastavení oprávnění.
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceLanding;
