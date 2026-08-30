import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Styled native select — keeps things dependency-free and reliable. */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    ({ className, children, ...props }, ref) => (
        <div className={cn("relative", className)}>
            <select
                ref={ref}
                className={cn(
                    "h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm shadow-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
                )}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
    ),
);
Select.displayName = "Select";

export { Select };
