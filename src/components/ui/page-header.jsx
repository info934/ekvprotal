import React from 'react';
import { cn } from '@/lib/utils';

const PageHeader = ({ icon: Icon, title, description, actions, meta, className }) => {
  return (
    <header className={cn("flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
          {meta && <div className="mt-3">{meta}</div>}
        </div>
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
};

export default PageHeader;
