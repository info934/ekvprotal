import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-blue-700",
        secondary:
          "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200",
        destructive:
          "border-red-600 bg-red-600 text-white hover:bg-red-700",
        outline: "border-slate-300 bg-white text-slate-700",
        success: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700",
        warning: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-700",
        info: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
        nabidka: "bg-gray-100 text-gray-800 border-gray-200",
        active: "bg-green-100 text-green-800 border-green-200",
        ready_for_delivery: "bg-blue-100 text-blue-800 border-blue-200",
        delivered: "bg-purple-100 text-purple-800 border-purple-200",
        closed: "bg-slate-100 text-slate-800 border-slate-200"
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
