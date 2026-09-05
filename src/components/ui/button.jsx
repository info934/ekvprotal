import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import React from 'react';

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-semibold leading-5 shadow-sm ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default: 'border-primary bg-primary text-primary-foreground hover:bg-blue-700 hover:shadow-md active:bg-blue-800',
				destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:bg-red-700 active:bg-red-800',
				outline:
          'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 hover:shadow-md',
				secondary:
          'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200 hover:text-slate-950 hover:shadow-md',
				ghost: 'border-transparent bg-transparent shadow-none hover:bg-slate-100 hover:text-slate-950',
				link: 'border-transparent bg-transparent text-primary shadow-none underline-offset-4 hover:underline',
			},
			size: {
				default: 'h-11 px-4 py-2',
				sm: 'h-9 rounded-md px-3 text-xs',
				lg: 'h-11 rounded-md px-5 text-base',
				icon: 'h-11 w-11',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : 'button';
	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			ref={ref}
			{...props}
		/>
	);
});
Button.displayName = 'Button';

export { Button, buttonVariants };
