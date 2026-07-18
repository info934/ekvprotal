import React from 'react';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TabsList } from '@/components/ui/tabs';
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
  <header className={cn('sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur', className)}>
    <div className="app-page-wide flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 px-2 text-slate-600">
          <ChevronLeft className="mr-1 h-4 w-4" />
          <span className="hidden sm:inline">{backLabel}</span>
        </Button>
        <div className="min-w-0 border-l border-slate-200 pl-3">
          <h1 className="truncate text-xl font-semibold text-slate-950 sm:text-2xl" title={title}>{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500 sm:text-sm" title={subtitle}>{subtitle}</p>}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {status}
        {actions}
      </div>
    </div>
  </header>
);

export const RecordWorkspaceTabsList = ({ children, className }) => (
  <div className="w-full overflow-x-auto pb-1">
    <TabsList
      className={cn(
        'inline-flex h-10 min-w-full w-max justify-start gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm',
        '[&_[role=tab]]:h-8 [&_[role=tab]]:shrink-0 [&_[role=tab]]:gap-1.5 [&_[role=tab]]:px-3 [&_[role=tab]]:text-xs sm:[&_[role=tab]]:text-sm',
        className,
      )}
    >
      {children}
    </TabsList>
  </div>
);

export const RecordMetricGrid = ({ children, className }) => (
  <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
    {children}
  </div>
);

