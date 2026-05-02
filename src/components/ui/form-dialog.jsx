import React from 'react';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const dialogSizeClasses = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-4xl',
};

const FormDialogContent = React.forwardRef(({ className, size = 'md', ...props }, ref) => (
  <DialogContent
    ref={ref}
    className={cn(
      'flex max-h-[92vh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full',
      dialogSizeClasses[size] || size,
      className
    )}
    {...props}
  />
));
FormDialogContent.displayName = 'FormDialogContent';

const FormDialogHeader = ({ icon: Icon, title, description, className }) => (
  <DialogHeader className={cn('border-b bg-slate-50/60 px-5 py-4 text-left sm:px-6', className)}>
    <DialogTitle className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight">
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 truncate">{title}</span>
    </DialogTitle>
    {description && <DialogDescription>{description}</DialogDescription>}
  </DialogHeader>
);

const FormDialogBody = ({ className, ...props }) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6', className)} {...props} />
);

const FormDialogFooter = ({ className, ...props }) => (
  <DialogFooter
    className={cn(
      'border-t bg-slate-50/60 px-5 py-4 sm:px-6 sm:space-x-2',
      className
    )}
    {...props}
  />
);

export { FormDialogContent, FormDialogHeader, FormDialogBody, FormDialogFooter };
