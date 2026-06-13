import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Collapsible({
    title,
    badge,
    defaultOpen = false,
    children,
    className,
}: {
    title: React.ReactNode;
    badge?: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    const [open, setOpen] = React.useState(defaultOpen);
    return (
        <div className={cn("rounded-md border border-border", className)}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40 transition-colors"
            >
                <ChevronRight
                    className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                    )}
                />
                <span className="flex-1">{title}</span>
                {badge}
            </button>
            {open && <div className="border-t border-border p-3">{children}</div>}
        </div>
    );
}
