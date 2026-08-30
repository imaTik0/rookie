import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, FileText, Globe, Plus } from "lucide-react";
import { projectsApi } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function ProjectsPage() {
    const [page, setPage] = React.useState(1);
    const [createOpen, setCreateOpen] = React.useState(false);
    const [crawlOpen, setCrawlOpen] = React.useState(false);

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["projects", page],
        queryFn: () => projectsApi.list(page, 12),
    });

    return (
        <div>
            <PageHeader
                title="Projects"
                description="A project groups documentation files and owns a vector collection used for retrieval."
                actions={
                    <>
                        <Button variant="outline" onClick={() => setCrawlOpen(true)}>
                            <Globe /> From URL
                        </Button>
                        <Button onClick={() => setCreateOpen(true)}>
                            <Plus /> New project
                        </Button>
                    </>
                }
            />

            {isLoading && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
                </div>
            )}

            {isError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">
                    Failed to load projects: {(error as Error).message}
                </Card>
            )}

            {data && data.projects.length === 0 && (
                <EmptyState
                    icon={Briefcase}
                    title="No projects yet"
                    description="Create a project from uploaded files, or crawl a documentation site directly."
                    action={
                        <Button onClick={() => setCreateOpen(true)}>
                            <Plus /> New project
                        </Button>
                    }
                />
            )}

            {data && data.projects.length > 0 && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {data.projects.map((p) => (
                            <Link key={p.id} to={`/projects/${p.id}`}>
                                <Card className="h-full p-5 transition-colors hover:border-accent/40">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex size-9 items-center justify-center rounded-md bg-accent-soft">
                                            <Briefcase className="size-4 text-accent" />
                                        </div>
                                        <Badge variant="muted">
                                            <FileText className="size-3" />
                                            {p.files?.length ?? 0} files
                                        </Badge>
                                    </div>
                                    <p className="mt-3 truncate font-medium">{p.projectName}</p>
                                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                        {p.id}
                                    </p>
                                    <p
                                        className="mt-2 text-xs text-muted-foreground"
                                        title={formatDate(p.createdAt)}
                                    >
                                        created {timeAgo(p.createdAt)}
                                    </p>
                                </Card>
                            </Link>
                        ))}
                    </div>
                    <Pagination meta={data.meta} onPage={setPage} />
                </>
            )}

            <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
            <CrawlProjectDialog open={crawlOpen} onClose={() => setCrawlOpen(false)} />
        </div>
    );
}

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [name, setName] = React.useState("");
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: () => projectsApi.create({ projectName: name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            setName("");
            onClose();
        },
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="New project"
            description="Create an empty project; attach files afterwards from the project page."
        >
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                }}
            >
                <div className="space-y-2">
                    <Label htmlFor="project-name">Project name</Label>
                    <Input
                        id="project-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Stripe API Docs"
                        minLength={3}
                        required
                    />
                </div>
                {mutation.isError && (
                    <p className="text-sm text-failure">{(mutation.error as Error).message}</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={mutation.isPending || name.length < 3}>
                        {mutation.isPending ? "Creating…" : "Create"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function CrawlProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [name, setName] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [maxPages, setMaxPages] = React.useState(50);
    const [jobId, setJobId] = React.useState<string | null>(null);
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const mutation = useMutation({
        mutationFn: () => projectsApi.createFromUrl({ projectName: name, url, maxPages }),
        onSuccess: (job) => {
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            setJobId(job.id);
        },
    });

    const close = () => {
        setJobId(null);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={close}
            title="Create project from URL"
            description="Crawls the documentation site in the background and indexes the extracted Markdown."
        >
            {jobId
                ? (
                    <div className="space-y-4 text-sm">
                        <p>
                            Crawl started as job <code className="font-mono">{jobId}</code>. Track
                            its progress on the Jobs page; the new project appears when it
                            succeeds.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={close}>Close</Button>
                            <Button
                                onClick={() => {
                                    close();
                                    navigate("/jobs");
                                }}
                            >
                                Go to jobs
                            </Button>
                        </div>
                    </div>
                )
                : (
                    <form
                        className="space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            mutation.mutate();
                        }}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="crawl-name">Project name</Label>
                            <Input
                                id="crawl-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Docs Project"
                                minLength={3}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="crawl-url">Documentation URL</Label>
                            <Input
                                id="crawl-url"
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://docs.example.com"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="crawl-max">Max pages (1–200)</Label>
                            <Input
                                id="crawl-max"
                                type="number"
                                min={1}
                                max={200}
                                value={maxPages}
                                onChange={(e) => setMaxPages(Number(e.target.value))}
                            />
                        </div>
                        {mutation.isError && (
                            <p className="text-sm text-failure">
                                {(mutation.error as Error).message}
                            </p>
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={close}>Cancel</Button>
                            <Button type="submit" disabled={mutation.isPending}>
                                {mutation.isPending ? "Starting…" : "Start crawl"}
                            </Button>
                        </div>
                    </form>
                )}
        </Dialog>
    );
}
