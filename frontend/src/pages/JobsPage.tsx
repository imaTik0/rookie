import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ListChecks } from "lucide-react";
import { jobsApi } from "@/lib/api";
import type { Job, JobKind, JobStatus } from "@/lib/types";
import { formatDate, timeAgo, tryPrettyJson } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, TypeBadge } from "@/components/shared/StatusBadge";
import { Collapsible } from "@/components/shared/Collapsible";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const KINDS: JobKind[] = ["EXECUTE_TEST_SUITE", "CRAWL_DOCS"];
const STATUSES: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];

export function JobsPage() {
    const [params, setParams] = useSearchParams();
    const queryClient = useQueryClient();

    const page = Number(params.get("page") ?? "1");
    const kind = params.get("kind") ?? "";
    const status = params.get("status") ?? "";

    const setParam = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        setParams(next);
    };

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["jobs", page, kind, status],
        queryFn: () =>
            jobsApi.list({
                page,
                limit: 12,
                kind: (kind || undefined) as JobKind | undefined,
                status: (status || undefined) as JobStatus | undefined,
            }),
        // Live-poll while anything is pending/running.
        refetchInterval: (query) => {
            const items = query.state.data?.items;
            return items?.some((j) => j.status === "RUNNING" || j.status === "PENDING")
                ? 2000
                : false;
        },
    });

    const cancel = async (id: string) => {
        if (!confirm(`Request cancellation of job ${id}?`)) return;
        await jobsApi.cancel(id);
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
    };

    return (
        <div>
            <PageHeader
                title="Jobs"
                description="Background work: test-suite executions and documentation crawls. Running jobs refresh automatically."
            />

            <div className="mb-4 flex flex-wrap gap-2">
                <Select
                    className="w-52"
                    value={kind}
                    onChange={(e) => setParam("kind", e.target.value)}
                >
                    <option value="">All kinds</option>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
                <Select
                    className="w-44"
                    value={status}
                    onChange={(e) => setParam("status", e.target.value)}
                >
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
            </div>

            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
                </div>
            )}

            {isError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">
                    Failed to load jobs: {(error as Error).message}
                </Card>
            )}

            {data && data.items.length === 0 && (
                <EmptyState
                    icon={ListChecks}
                    title="No jobs"
                    description="Execute a test suite or start a documentation crawl to see jobs here."
                />
            )}

            {data && data.items.length > 0 && (
                <div className="space-y-2">
                    {data.items.map((job) => <JobCard key={job.id} job={job} onCancel={cancel} />)}
                    <Pagination meta={data.meta} onPage={(p) => setParam("page", String(p))} />
                </div>
            )}
        </div>
    );
}

function JobCard({ job, onCancel }: { job: Job; onCancel: (id: string) => void }) {
    const active = job.status === "RUNNING" || job.status === "PENDING";
    const reportId = job.result?.reportId as string | undefined;
    const projectId = job.result?.projectId as string | undefined;

    return (
        <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={job.status} className="w-28 justify-center" />
                <TypeBadge type={job.kind} />
                <span className="font-mono text-sm">{job.id}</span>
                <span className="ml-auto text-xs text-muted-foreground" title={formatDate(job.createdAt)}>
                    {timeAgo(job.createdAt)}
                </span>
                {reportId && (
                    <Link to={`/reports/${reportId}`}>
                        <Button variant="outline" size="sm">View report</Button>
                    </Link>
                )}
                {projectId && (
                    <Link to={`/projects/${projectId}`}>
                        <Button variant="outline" size="sm">View project</Button>
                    </Link>
                )}
                {active && (
                    <Button variant="destructive" size="sm" onClick={() => onCancel(job.id)}>
                        <Ban /> Cancel
                    </Button>
                )}
            </div>
            {job.progress && active && (
                <p className="mt-2 flex items-center gap-2 text-xs text-info">
                    <span className="size-1.5 animate-pulse rounded-full bg-current" />
                    {job.progress}
                </p>
            )}
            {job.error && <p className="mt-2 font-mono text-xs text-failure">{job.error}</p>}
            <div className="mt-2">
                <Collapsible
                    title="Details"
                    badge={
                        job.finishedAt
                            ? <Badge variant="muted">finished {timeAgo(job.finishedAt)}</Badge>
                            : undefined
                    }
                >
                    <CodeBlock
                        code={tryPrettyJson({
                            params: job.params,
                            result: job.result,
                            progress: job.progress,
                            startedAt: job.startedAt,
                            finishedAt: job.finishedAt,
                        })}
                        maxHeight="16rem"
                    />
                </Collapsible>
            </div>
        </Card>
    );
}
