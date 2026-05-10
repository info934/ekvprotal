import React from 'react';
import { cn } from '@/lib/utils';

const PageHeader = ({ icon: Icon, title, description, actions, meta, className }) => {
  return (
    <header className={cn("flex min-w-0 flex-col gap-4 border-b border-slate-200/90 bg-white/90 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary shadow-inner">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.65rem]">
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
