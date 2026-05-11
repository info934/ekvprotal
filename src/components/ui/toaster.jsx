import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';

const toastIconConfig = {
	default: {
		icon: Info,
		className: 'bg-blue-50 text-blue-700 ring-blue-100',
	},
	success: {
		icon: CheckCircle2,
		className: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
	},
	warning: {
		icon: AlertTriangle,
		className: 'bg-amber-100 text-amber-700 ring-amber-200',
	},
	destructive: {
		icon: XCircle,
		className: 'bg-red-100 text-red-700 ring-red-200',
	},
};

export function Toaster() {
	const { toasts } = useToast();

	return (
		<ToastProvider>
			{toasts.map(({ id, title, description, action, ...props }) => {
				const variant = props.variant || 'default';
				const config = toastIconConfig[variant] || toastIconConfig.default;
				const Icon = config.icon;

				return (
					<Toast key={id} {...props}>
						<div className="flex min-w-0 flex-1 items-start gap-3">
							<div className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1', config.className)}>
								<Icon className="h-5 w-5" />
							</div>
							<div className="grid min-w-0 gap-1 pt-0.5">
								{title && <ToastTitle>{title}</ToastTitle>}
								{description && (
									<ToastDescription>{description}</ToastDescription>
								)}
							</div>
						</div>
						{action}
						<ToastClose />
					</Toast>
				);
			})}
			<ToastViewport />
		</ToastProvider>
	);
}
