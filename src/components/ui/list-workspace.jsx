import React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ListWorkspaceToolbar = ({ primary, secondary, className }) => (
  <div className={cn('portal-list-toolbar flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between', className)}>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{primary}</div>
    {secondary && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{secondary}</div>}
  </div>
);

export const ListViewModeToggle = ({ value, onChange, options, className }) => (
  <div className={cn('inline-flex h-12 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5', className)}>
    {options.map(({ value: optionValue, label, icon: Icon }) => {
      const active = value === optionValue;
      return (
        <Button
          key={optionValue}
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-11 w-11 rounded-md text-slate-500 shadow-none', active && 'bg-white text-primary shadow-sm hover:bg-white')}
          onClick={() => onChange(optionValue)}
          aria-label={label}
          aria-pressed={active}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      );
    })}
  </div>
);

