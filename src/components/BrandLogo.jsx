import React from 'react';
import { cn } from '@/lib/utils';

export default function BrandLogo({ compact = false, className }) {
  return (
    <span className={cn('block shrink-0', compact ? 'relative aspect-[394/180] overflow-hidden' : '', className)}>
      <img
        src="/branding/ekv-project-logo.png"
        alt="EKV Project – make it simple"
        width={1015}
        height={180}
        className={compact ? 'absolute left-0 top-0 h-full w-auto max-w-none' : 'block h-auto w-full'}
      />
    </span>
  );
}
