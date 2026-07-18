import React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ListWorkspaceToolbar = ({ primary, secondary, className }) => (
  <div className={cn('app-surface sticky top-0 z-20 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between', className)}>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{primary}</div>
    {secondary && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{secondary}</div>}
  </div>
);

export const ListViewModeToggle = ({ value, onChange, options, className }) => (
  <div className={cn('inline-flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 p-1', className)}>
    {options.map(({ value: optionValue, label, icon: Icon }) => {
      const active = value === optionValue;
      return (
        <Button
          key={optionValue}
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7 rounded-sm text-slate-500 shadow-none', active && 'bg-white text-primary shadow-sm hover:bg-white')}
          onClick={() => onChange(optionValue)}
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      );
    })}
  </div>
);

