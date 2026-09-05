import React from 'react';
import { cn } from '@/lib/utils';

const PageHeader = ({ icon: Icon, title, description, actions, meta, className }) => {
  return (
    <header className={cn("portal-page-heading flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="sr-only" aria-hidden="true">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-slate-950 sm:text-[28px]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-wrap text-sm leading-5 text-slate-500">
              {description}
            </p>
          )}
          {meta && <div className="mt-2">{meta}</div>}
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
