import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { filesApi } from "@/lib/api";
import { formatBytes, formatDate, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function FilesPage() {
    const [page, setPage] = React.useState(1);
    const queryClient = useQueryClient();
    const inputRef = React.useRef<HTMLInputElement>(null);

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["files", page],
        queryFn: () => filesApi.list(page, 15),
    });

    const upload = useMutation({
        mutationFn: (files: File[]) =>
            files.length === 1 ? filesApi.upload(files[0]) : filesApi.uploadMany(files),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
    });

    const onDelete = async (id: string, name: string) => {
        if (
            !confirm(
                `Delete "${name}"? Its vectors are removed from every project that uses it. This cannot be undone.`,
            )
        ) return;
        await filesApi.remove(id);
        queryClient.invalidateQueries({ queryKey: ["files"] });
    };

    return (
        <div>
            <PageHeader
                title="Files"
                description="Uploaded documentation files (max 10 MB each). Attach them to a project to index them for retrieval."
                actions={
                    <>
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                if (files.length) upload.mutate(files);
                                e.target.value = "";
                            }}
                        />
                        <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
                            <Upload /> {upload.isPending ? "Uploading…" : "Upload"}
                        </Button>
                    </>
                }
            />

            {upload.isError && (
                <Card className="mb-4 border-failure/30 p-3 text-sm text-failure">
                    Upload failed: {(upload.error as Error).message}
                </Card>
            )}

            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
            )}

            {isError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">
                    Failed to load files: {(error as Error).message}
                </Card>
            )}

            {data && data.files.length === 0 && (
                <EmptyState
                    icon={FileText}
                    title="No files uploaded"
                    description="Upload Markdown, text, or PDF documentation to evaluate."
                    action={
                        <Button onClick={() => inputRef.current?.click()}>
                            <Upload /> Upload
                        </Button>
                    }
                />
            )}

            {data && data.files.length > 0 && (
                <div className="space-y-2">
                    {data.files.map((f) => (
                        <Card key={f.id} className="flex items-center gap-3 px-4 py-3">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{f.filename}</p>
                                <p className="text-xs text-muted-foreground">
                                    <span className="font-mono">{f.id}</span> · {f.mimetype} ·{" "}
                                    {formatBytes(f.size)}
                                </p>
                            </div>
                            <span
                                className="text-xs text-muted-foreground"
                                title={formatDate(f.createdAt)}
                            >
                                {timeAgo(f.createdAt)}
                            </span>
                            <a href={filesApi.downloadUrl(f.id)} title="Download">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <Download />
                                </Button>
                            </a>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                title="Delete"
                                className="text-muted-foreground hover:text-failure"
                                onClick={() => onDelete(f.id, f.filename)}
                            >
                                <Trash2 />
                            </Button>
                        </Card>
                    ))}
                    <Pagination meta={data.meta} onPage={setPage} />
                </div>
            )}
        </div>
    );
}
