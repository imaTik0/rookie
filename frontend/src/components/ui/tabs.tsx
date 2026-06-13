import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
    value: string;
    setValue: (v: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({
    defaultValue,
    value: controlled,
    onValueChange,
    className,
    children,
}: {
    defaultValue?: string;
    value?: string;
    onValueChange?: (v: string) => void;
    className?: string;
    children: React.ReactNode;
}) {
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const value = controlled ?? internal;
    const setValue = (v: string) => {
        setInternal(v);
        onValueChange?.(v);
    };
    return (
        <TabsContext.Provider value={{ value, setValue }}>
            <div className={className}>{children}</div>
        </TabsContext.Provider>
    );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                "inline-flex h-9 items-center gap-1 rounded-lg bg-muted/60 p-1 text-muted-foreground",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function TabsTrigger({
    value,
    className,
    children,
}: {
    value: string;
    className?: string;
    children: React.ReactNode;
}) {
    const ctx = React.useContext(TabsContext)!;
    const active = ctx.value === value;
    return (
        <button
            type="button"
            onClick={() => ctx.setValue(value)}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors cursor-pointer",
                active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function TabsContent({
    value,
    className,
    children,
}: {
    value: string;
    className?: string;
    children: React.ReactNode;
}) {
    const ctx = React.useContext(TabsContext)!;
    if (ctx.value !== value) return null;
    return <div className={cn("mt-4", className)}>{children}</div>;
}
