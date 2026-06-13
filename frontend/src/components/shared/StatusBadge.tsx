import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AnyStatus = string;

const STYLES: Record<string, { variant: "success" | "failure" | "warning" | "info" | "muted"; pulse?: boolean }> = {
    SUCCESS: { variant: "success" },
    SUCCEEDED: { variant: "success" },
    FAILED: { variant: "failure" },
    PARTIAL_FAILURE: { variant: "warning" },
    CANCELLED: { variant: "muted" },
    PENDING: { variant: "muted", pulse: true },
    RUNNING: { variant: "info", pulse: true },
};

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
    const style = STYLES[status] ?? { variant: "muted" as const };
    return (
        <Badge variant={style.variant} className={className}>
            <span
                className={cn(
                    "size-1.5 rounded-full bg-current",
                    style.pulse && "animate-pulse",
                )}
            />
            {status.replace(/_/g, " ")}
        </Badge>
    );
}

const TYPE_LABEL: Record<string, string> = {
    TEST_SCENARIO: "Test scenario",
    CODE_GENERATION: "Code generation",
    MASTER_PLAN: "Master plan",
    EXECUTE_TEST_SUITE: "Suite execution",
    CRAWL_DOCS: "Docs crawl",
};

export function TypeBadge({ type, className }: { type?: string; className?: string }) {
    if (!type) return null;
    const variant = type === "MASTER_PLAN" ? "accent" : "outline";
    return (
        <Badge variant={variant} className={className}>
            {TYPE_LABEL[type] ?? type}
        </Badge>
    );
}

const GAP_STYLE: Record<string, "failure" | "warning" | "info" | "muted" | "accent"> = {
    MISSING: "failure",
    INCORRECT: "failure",
    AMBIGUOUS: "warning",
    CONFIG: "info",
    ENVIRONMENT: "info",
    UNKNOWN: "muted",
};

export function GapBadge({ gap, className }: { gap: string; className?: string }) {
    return (
        <Badge variant={GAP_STYLE[gap] ?? "muted"} className={className}>
            {gap}
        </Badge>
    );
}
