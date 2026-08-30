import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
    {
        variants: {
            variant: {
                default: "border-border bg-muted text-foreground",
                muted: "border-transparent bg-muted text-muted-foreground",
                success: "border-success/25 bg-success-soft text-success",
                failure: "border-failure/25 bg-failure-soft text-failure",
                warning: "border-warning/25 bg-warning-soft text-warning",
                info: "border-info/25 bg-info-soft text-info",
                accent: "border-accent/25 bg-accent-soft text-accent",
                outline: "border-border text-muted-foreground",
            },
        },
        defaultVariants: { variant: "default" },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
