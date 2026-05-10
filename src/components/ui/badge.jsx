import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-blue-600 bg-blue-600 text-primary-foreground hover:bg-blue-700",
        secondary:
          "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200",
        destructive:
          "border-rose-200 bg-rose-100 text-rose-700 hover:bg-rose-100",
        outline: "border-slate-200 bg-white text-slate-600",
        success: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700",
        warning: "border-amber-200 bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700",
        info: "border-sky-200 bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-700",
        nabidka: "border-orange-200 bg-orange-100 text-orange-700",
        active: "border-emerald-200 bg-emerald-100 text-emerald-700",
        ready_for_delivery: "border-blue-200 bg-blue-100 text-blue-700",
        delivered: "border-violet-200 bg-violet-100 text-violet-700",
        closed: "border-slate-200 bg-slate-100 text-slate-700"
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = "Badge";

export { Badge, badgeVariants };
