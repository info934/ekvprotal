import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const EkvLoader = ({
  title = 'Načítám pracovní prostředí',
  description = 'Připravuji aktuální data a oprávnění.',
  className,
  compact = false,
  showStatus = true,
}) => (
  <div
    className={cn(
      'flex w-full flex-col items-center justify-center text-center',
      compact ? 'min-h-40 gap-3 p-4' : 'min-h-[50vh] gap-5 p-8',
      className
    )}
    role="status"
    aria-live="polite"
  >
    <div className={cn('ekv-ai-loader relative grid place-items-center', compact ? 'h-14 w-14' : 'h-20 w-20')}>
      <span className="ekv-ai-loader__rail ekv-ai-loader__rail--top" aria-hidden="true" />
      <span className="ekv-ai-loader__rail ekv-ai-loader__rail--bottom" aria-hidden="true" />
      <span className="ekv-ai-loader__node ekv-ai-loader__node--one" aria-hidden="true" />
      <span className="ekv-ai-loader__node ekv-ai-loader__node--two" aria-hidden="true" />
      <span className="ekv-ai-loader__node ekv-ai-loader__node--three" aria-hidden="true" />
      <img src="/favicon.svg" alt="" className={cn('relative z-10 rounded-xl shadow-sm', compact ? 'h-10 w-10' : 'h-14 w-14')} />
    </div>

    <div className="max-w-sm">
      <p className={cn('font-semibold text-slate-900', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
    </div>

    <div className={cn('ekv-ai-loader__progress overflow-hidden rounded-full bg-slate-200', compact ? 'h-1 w-28' : 'h-1.5 w-40')} aria-hidden="true">
      <span className="block h-full rounded-full bg-primary" />
    </div>

    {showStatus && (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Zabezpečené spojení EKV
      </span>
    )}
  </div>
);

export default EkvLoader;
