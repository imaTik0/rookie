import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, className }: { text: string; className?: string }) {
    const [copied, setCopied] = React.useState(false);
    return (
        <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground hover:text-foreground", className)}
            aria-label="Copy to clipboard"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch {
                    // clipboard unavailable
                }
            }}
        >
            {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
    );
}

export function CodeBlock({
    code,
    label,
    maxHeight = "24rem",
    className,
    wrap = false,
}: {
    code: string;
    label?: string;
    maxHeight?: string;
    className?: string;
    wrap?: boolean;
}) {
    return (
        <div
            className={cn(
                "group relative rounded-md border border-border bg-background/80",
                className,
            )}
        >
            {label && (
                <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {label}
                    </span>
                    <CopyButton text={code} />
                </div>
            )}
            {!label && (
                <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <CopyButton text={code} />
                </div>
            )}
            <pre
                className={cn(
                    "overflow-auto p-3 font-mono text-[12.5px] leading-relaxed text-foreground/90",
                    wrap && "whitespace-pre-wrap break-words",
                )}
                style={{ maxHeight }}
            >
                <code>{code}</code>
            </pre>
        </div>
    );
}
