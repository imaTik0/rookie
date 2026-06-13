import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}

/** Lightweight shadcn-style dialog (portal + overlay, Escape to close). */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
    React.useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
            <div
                className="fixed inset-0 bg-black/65 backdrop-blur-[2px]"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    "relative z-10 mt-8 w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl",
                    className,
                )}
            >
                <div className="flex items-start justify-between gap-4 border-b border-border p-5">
                    <div>
                        <h2 className="text-base font-semibold">{title}</h2>
                        {description && (
                            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        )}
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                        <X />
                    </Button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>,
        document.body,
    );
}
