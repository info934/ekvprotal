import React from 'react';
import { cn } from '@/lib/utils';

const PageHeader = ({ icon: Icon, title, description, actions, meta, className }) => {
  return (
    <header className={cn("flex min-w-0 flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/10 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.75rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-wrap text-sm leading-5 text-slate-600">
              {description}
            </p>
          )}
          {meta && <div className="mt-3">{meta}</div>}
        </div>
      </div>
      {actions && (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:max-w-full">
          {actions}
        </div>
      )}
    </header>
  );
};

export default PageHeader;
