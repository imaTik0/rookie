import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/lib/types";

export function Pagination({
    meta,
    onPage,
}: {
    meta: PaginationMeta | undefined;
    onPage: (page: number) => void;
}) {
    if (!meta || meta.totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">
                Page {meta.currentPage} of {meta.totalPages} · {meta.totalItems} items
            </span>
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={meta.currentPage <= 1}
                    onClick={() => onPage(meta.currentPage - 1)}
                >
                    <ChevronLeft /> Prev
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={meta.currentPage >= meta.totalPages}
                    onClick={() => onPage(meta.currentPage + 1)}
                >
                    Next <ChevronRight />
                </Button>
            </div>
        </div>
    );
}
