import { cn } from '@/lib/utils';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import React from 'react';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef(({ className, ...props }, ref) => (
	<ToastPrimitives.Viewport
		ref={ref}
		className={cn(
			'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-3 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[440px]',
			className,
		)}
		{...props}
	/>
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
	'data-[swipe=move]:transition-none group relative pointer-events-auto flex w-full items-start justify-between gap-4 overflow-hidden rounded-2xl border p-4 pr-10 shadow-2xl shadow-slate-950/10 backdrop-blur-xl transition-all data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full data-[state=closed]:slide-out-to-right-full',
	{
		variants: {
			variant: {
				default: 'border-slate-200/80 bg-white/95 text-slate-900',
				success: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-950',
				warning: 'border-amber-200/80 bg-amber-50/95 text-amber-950',
				destructive:
          'group destructive border-red-200/80 bg-red-50/95 text-red-950',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
);

const Toast = React.forwardRef(({ className, variant, ...props }, ref) => {
	return (
		<ToastPrimitives.Root
			ref={ref}
			className={cn(toastVariants({ variant }), className)}
			{...props}
		/>
	);
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef(({ className, ...props }, ref) => (
		<ToastPrimitives.Action
		ref={ref}
		className={cn(
			'inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/70 px-3 text-sm font-semibold text-slate-700 ring-offset-background transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-red-200 group-[.destructive]:text-red-700 group-[.destructive]:hover:bg-red-100',
			className,
		)}
		{...props}
	/>
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef(({ className, ...props }, ref) => (
	<ToastPrimitives.Close
		ref={ref}
		className={cn(
			'absolute right-3 top-3 rounded-lg p-1 text-slate-400 opacity-70 transition-opacity hover:bg-white/70 hover:text-slate-900 focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-400 group-[.destructive]:hover:text-red-700 group-[.destructive]:focus:ring-red-400',
			className,
		)}
		toast-close=""
		{...props}
	>
		<X className="h-4 w-4" />
	</ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef(({ className, ...props }, ref) => (
	<ToastPrimitives.Title
		ref={ref}
		className={cn('text-sm font-semibold leading-5 tracking-tight', className)}
		{...props}
	/>
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef(({ className, ...props }, ref) => (
	<ToastPrimitives.Description
		ref={ref}
		className={cn('text-sm leading-5 text-slate-600 group-[.destructive]:text-red-700', className)}
		{...props}
	/>
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

export {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
};
