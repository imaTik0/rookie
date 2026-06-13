import { NavLink, Outlet } from "react-router-dom";
import {
    Briefcase,
    FileText,
    ListChecks,
    ScrollText,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_PRIMARY = [
    { to: "/projects", label: "Projects", icon: Briefcase },
];

const NAV_SECONDARY = [
    { to: "/reports", label: "Reports", icon: ScrollText },
    { to: "/jobs", label: "Jobs", icon: ListChecks },
    { to: "/files", label: "Files", icon: FileText },
];

export function Layout() {
    return (
        <div className="flex h-full">
            <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-surface">
                {/* Brand */}
                <div className="flex h-13 items-center gap-2.5 px-4 pt-5 pb-3">
                    <div className="flex size-6 items-center justify-center rounded bg-accent/15">
                        <Zap className="size-3.5 text-accent" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">rookie</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-2 pt-3 pb-2 space-y-px">
                    {NAV_PRIMARY.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) =>
                                cn(
                                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                                    isActive
                                        ? "bg-accent/10 text-accent font-medium"
                                        : "text-foreground/70 hover:bg-muted/60 hover:text-foreground",
                                )}
                        >
                            <Icon className="size-4 shrink-0" />
                            {label}
                        </NavLink>
                    ))}

                    <div className="pt-3">
                        <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                            Explore
                        </p>
                        {NAV_SECONDARY.map(({ to, label, icon: Icon }) => (
                            <NavLink
                                key={to}
                                to={to}
                                className={({ isActive }) =>
                                    cn(
                                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                                        isActive
                                            ? "bg-accent/10 text-accent font-medium"
                                            : "text-foreground/60 hover:bg-muted/60 hover:text-foreground",
                                    )}
                            >
                                <Icon className="size-4 shrink-0" />
                                {label}
                            </NavLink>
                        ))}
                    </div>
                </nav>

                {/* Footer */}
                <div className="px-4 py-4 text-[11px] text-muted-foreground/50">
                    <a
                        href="/api/docs"
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-muted-foreground transition-colors"
                    >
                        API docs ↗
                    </a>
                </div>
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto bg-background">
                <div className="mx-auto max-w-5xl px-8 py-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
