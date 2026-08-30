import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ScrollText, Trash2 } from "lucide-react";
import { projectsApi, reportsApi } from "@/lib/api";
import type { ReportStatus, ReportType } from "@/lib/types";
import { formatDate, shortId, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, TypeBadge } from "@/components/shared/StatusBadge";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STATUSES: ReportStatus[] = ["PENDING", "RUNNING", "SUCCESS", "FAILED", "PARTIAL_FAILURE"];
const TYPES: ReportType[] = ["TEST_SCENARIO", "CODE_GENERATION", "MASTER_PLAN"];

export function ReportsPage() {
    const [params, setParams] = useSearchParams();
    const queryClient = useQueryClient();

    const page = Number(params.get("page") ?? "1");
    const projectId = params.get("projectId") ?? "";
    const testSuiteId = params.get("testSuiteId") ?? "";
    const status = params.get("status") ?? "";
    const type = params.get("type") ?? "";

    const setParam = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        setParams(next);
    };

    const { data: projects } = useQuery({
        queryKey: ["projects-all"],
        queryFn: () => projectsApi.list(1, 100),
    });

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["reports", page, projectId, testSuiteId, status, type],
        queryFn: () =>
            reportsApi.list({
                page,
                limit: 15,
                projectId: projectId || undefined,
                testSuiteId: testSuiteId || undefined,
                status: (status || undefined) as ReportStatus | undefined,
                type: (type || undefined) as ReportType | undefined,
            }),
    });

    const onDelete = async (id: string) => {
        if (!confirm(`Delete report ${id}? This cannot be undone.`)) return;
        await reportsApi.remove(id);
        queryClient.invalidateQueries({ queryKey: ["reports"] });
    };

    return (
        <div>
            <PageHeader
                title="Reports"
                description="Execution reports produced by test-suite runs and master-plan evaluations."
            />

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Select
                    className="w-52"
                    value={projectId}
                    onChange={(e) => setParam("projectId", e.target.value)}
                >
                    <option value="">All projects</option>
                    {projects?.projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.projectName}</option>
                    ))}
                </Select>
                <Select
                    className="w-44"
                    value={status}
                    onChange={(e) => setParam("status", e.target.value)}
                >
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
                <Select
                    className="w-44"
                    value={type}
                    onChange={(e) => setParam("type", e.target.value)}
                >
                    <option value="">All types</option>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                {testSuiteId && (
                    <button
                        type="button"
                        onClick={() => setParam("testSuiteId", "")}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs text-accent hover:bg-accent-soft/70"
                        title="Clear test suite filter"
                    >
                        suite: <span className="font-mono">{shortId(testSuiteId, 14)}</span> ✕
                    </button>
                )}
            </div>

            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
                </div>
            )}

            {isError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">
                    Failed to load reports: {(error as Error).message}
                </Card>
            )}

            {data && data.items.length === 0 && (
                <EmptyState
                    icon={ScrollText}
                    title="No reports yet"
                    description="Execute a test suite or run the master planner to produce a report."
                />
            )}

            {data && data.items.length > 0 && (
                <div className="space-y-2">
                    {data.items.map((r) => (
                        <Link
                            key={r.id}
                            to={`/reports/${r.id}`}
                            className="group flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-accent/40 hover:bg-card/80"
                        >
                            <StatusBadge status={r.status} className="w-36 justify-center" />
                            <TypeBadge type={r.type} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-sm text-foreground/90">
                                    {r.id}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {r.type === "MASTER_PLAN" && r.masterPlanGoals?.length
                                        ? `${r.masterPlanGoals.length} goals · ${
                                            r.masterPlanGoals[0]
                                        }`
                                        : r.testSuiteId
                                        ? `suite ${shortId(r.testSuiteId, 18)}`
                                        : "—"}
                                </div>
                            </div>
                            {r.type === "MASTER_PLAN" && r.structuredSummary && (
                                <span className="text-xs font-medium text-muted-foreground">
                                    {Math.round(
                                        r.structuredSummary.overallPassRate <= 1
                                            ? r.structuredSummary.overallPassRate * 100
                                            : r.structuredSummary.overallPassRate,
                                    )}% pass
                                </span>
                            )}
                            <span
                                className="w-24 text-right text-xs text-muted-foreground"
                                title={formatDate(r.createdAt)}
                            >
                                {timeAgo(r.createdAt)}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground opacity-0 transition-opacity hover:text-failure group-hover:opacity-100"
                                aria-label="Delete report"
                                onClick={(e) => {
                                    e.preventDefault();
                                    onDelete(r.id);
                                }}
                            >
                                <Trash2 />
                            </Button>
                            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    ))}
                    <Pagination meta={data.meta} onPage={(p) => setParam("page", String(p))} />
                </div>
            )}
        </div>
    );
}
