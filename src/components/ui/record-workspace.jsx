import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export const RecordWorkspaceHeader = ({
  title,
  subtitle,
  onBack,
  backLabel = 'Zpět',
  status,
  actions,
  className,
}) => (
  <header className={cn('portal-record-header', className)}>
    <div className="app-page-wide flex min-w-0 flex-col gap-2 py-3 [&>*+*]:!mt-0">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label={backLabel} className="min-h-11 w-fit shrink-0 px-2 text-slate-600">
          <ChevronLeft className="mr-1 h-4 w-4" />
          <span>{backLabel}</span>
        </Button>
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {subtitle && <p className="break-words text-xs font-medium tracking-wide text-slate-500 sm:text-sm" title={subtitle}>{subtitle}</p>}
            {status}
          </div>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]" title={title}>{title}</h1>
        </div>
      <div className="portal-record-actions flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
        {actions}
      </div>
      </div>
    </div>
  </header>
);

export const RecordWorkspaceTabsList = ({ children, className, ...props }) => (
  <div className="w-full overflow-x-auto pb-1">
    <TabsList
      {...props}
      className={cn(
        'portal-record-tabs inline-flex h-12 min-w-full w-max justify-start gap-1 rounded-none border-0 border-b border-slate-200 bg-transparent p-0 shadow-none sm:justify-start',
        '[&_[role=tab]]:h-11 [&_[role=tab]]:shrink-0 [&_[role=tab]]:gap-1.5 [&_[role=tab]]:px-3 [&_[role=tab]]:text-xs sm:[&_[role=tab]]:text-sm',
        className,
      )}
    >
      {children}
    </TabsList>
  </div>
);

export const RecordWorkspaceNavigation = ({ groups, activeTab, onTabChange, ariaLabel = 'Části zakázky' }) => {
  const availableGroups = groups.filter((group) => group.tabs?.length);
  const activeGroup = availableGroups.find((group) => group.tabs.some((tab) => tab.value === activeTab));
  return (
    <div className="min-w-0 space-y-2">
      <RecordWorkspaceTabsList aria-label={ariaLabel}>
        {availableGroups.map((group) => {
          const Icon = group.icon;
          // The primary tab keeps the existing panel/hash identity, including when a subsection is active.
          const value = group === activeGroup ? activeTab : group.tabs[0].value;
          return (
            <TabsTrigger key={group.label} value={value}>
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {group.label}
            </TabsTrigger>
          );
        })}
      </RecordWorkspaceTabsList>
      {activeGroup?.tabs.length > 1 && (
        <nav aria-label={`${activeGroup.label} – podčásti`} className="flex min-w-0 flex-wrap gap-1 rounded-lg bg-slate-100/80 p-1">
          {activeGroup.tabs.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              variant="ghost"
              aria-current={activeTab === tab.value ? 'page' : undefined}
              onClick={() => onTabChange(tab.value)}
              className={cn('min-h-11 rounded-md px-4 text-sm text-slate-600', activeTab === tab.value && 'bg-white font-semibold text-blue-700 shadow-sm hover:bg-white hover:text-blue-700')}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
      )}
    </div>
  );
};

export const RecordMetricGrid = ({ children, className }) => (
  <div className={cn('portal-record-metrics grid grid-cols-1 gap-0 sm:grid-cols-2 xl:grid-cols-4', className)}>
    {children}
  </div>
);

// Load a financial section on its first visit, then retain form state while the user compares sections.
export const RecordWorkspaceSection = ({ active, children, ...props }) => {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!active && !visited) return null;
  return <section {...props} hidden={!active}>{children}</section>;
};

