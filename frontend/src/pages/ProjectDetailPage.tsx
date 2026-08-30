import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeft,
    CheckCircle2,
    CircleDashed,
    Download,
    FileText,
    FlaskConical,
    Loader2,
    Pencil,
    Play,
    Plus,
    Radar,
    ScrollText,
    Square,
    Target,
    Trash2,
    Unlink,
    XCircle,
    Zap,
} from "lucide-react";
import { filesApi, projectsApi, reportsApi, runMasterPlan, testSuitesApi } from "@/lib/api";
import type { CreateTestSuite, PlannerEvent, TestSuite, TestSuiteMode } from "@/lib/types";
import { formatBytes, formatDate, shortId, timeAgo } from "@/lib/format";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, TypeBadge } from "@/components/shared/StatusBadge";
import { CodeBlock, CopyButton } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Main page ───────────────────────────────────────────────────────────────

export function ProjectDetailPage() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [renameOpen, setRenameOpen] = React.useState(false);
    const [attachOpen, setAttachOpen] = React.useState(false);
    const [suiteEditorOpen, setSuiteEditorOpen] = React.useState(false);
    const [editingSuite, setEditingSuite] = React.useState<TestSuite | null>(null);

    const { data: project, isLoading, isError, error } = useQuery({
        queryKey: ["project", projectId],
        queryFn: () => projectsApi.get(projectId!),
        enabled: !!projectId,
    });

    const { data: suites, refetch: refetchSuites } = useQuery({
        queryKey: ["testsuites", { projectId }],
        queryFn: () => testSuitesApi.list({ projectId, limit: 50 }),
        enabled: !!projectId,
    });

    const { data: reports } = useQuery({
        queryKey: ["reports", { projectId }],
        queryFn: () => reportsApi.list({ projectId, limit: 20 }),
        enabled: !!projectId,
    });

    const removeFile = useMutation({
        mutationFn: (fileId: string) => projectsApi.removeFiles(projectId!, [fileId]),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    });

    const executeSuite = useMutation({
        mutationFn: (id: string) => testSuitesApi.execute(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            navigate("/jobs");
        },
    });

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-64" />
            </div>
        );
    }

    if (isError || !project) {
        return (
            <Card className="border-failure/30 p-6 text-sm">
                <p className="text-failure">{(error as Error)?.message ?? "Project not found."}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/projects")}>
                    <ArrowLeft /> Back to projects
                </Button>
            </Card>
        );
    }

    const onDelete = async () => {
        if (!confirm(`Delete project "${project.projectName}"? This cannot be undone.`)) return;
        await projectsApi.remove(project.id);
        navigate("/projects");
    };

    return (
        <div>
            {/* Back link */}
            <Link
                to="/projects"
                className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="size-3.5" /> All projects
            </Link>

            {/* Header */}
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl font-semibold tracking-tight">
                            {project.projectName}
                        </h1>
                        <CopyButton text={project.id} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{project.id}</span>
                        <span className="mx-2 text-border">·</span>
                        created {formatDate(project.createdAt)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
                        <Pencil /> Rename
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onDelete}>
                        <Trash2 /> Delete
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="suites">
                <TabsList>
                    <TabsTrigger value="suites">
                        <FlaskConical className="size-3.5" />
                        Test Suites
                        {(suites?.items.length ?? 0) > 0 && (
                            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {suites!.items.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reports">
                        <ScrollText className="size-3.5" />
                        Reports
                        {(reports?.items.length ?? 0) > 0 && (
                            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {reports!.items.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="masterplan">
                        <Radar className="size-3.5" /> Master Plan
                    </TabsTrigger>
                    <TabsTrigger value="goal">
                        <Target className="size-3.5" /> Execute Goal
                    </TabsTrigger>
                    <TabsTrigger value="files">
                        <FileText className="size-3.5" />
                        Files
                        {(project.files?.length ?? 0) > 0 && (
                            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {project.files.length}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* ── Test Suites ── */}
                <TabsContent value="suites">
                    <div className="mb-3 flex justify-end">
                        <Button
                            size="sm"
                            onClick={() => {
                                setEditingSuite(null);
                                setSuiteEditorOpen(true);
                            }}
                        >
                            <Plus /> New suite
                        </Button>
                    </div>

                    {(suites?.items.length ?? 0) === 0
                        ? (
                            <EmptyState
                                icon={FlaskConical}
                                title="No test suites"
                                description="Create a reusable test suite to evaluate this project's documentation."
                                action={
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            setEditingSuite(null);
                                            setSuiteEditorOpen(true);
                                        }}
                                    >
                                        <Plus /> New suite
                                    </Button>
                                }
                            />
                        )
                        : (
                            <div className="space-y-2">
                                {suites!.items.map((s) => (
                                    <Card key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                        <TypeBadge type={s.mode} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-mono text-sm">{s.id}</p>
                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                {s.userGoal
                                                    ? s.userGoal
                                                    : `${s.minimalStoryLength}–${s.maximalStoryLength} steps`}
                                            </p>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {timeAgo(s.updatedAt)}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                size="sm"
                                                onClick={() => executeSuite.mutate(s.id)}
                                                disabled={executeSuite.isPending}
                                            >
                                                <Play /> Run
                                            </Button>
                                            <Link to={`/reports?testSuiteId=${s.id}`}>
                                                <Button variant="outline" size="sm">Reports</Button>
                                            </Link>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => {
                                                    setEditingSuite(s);
                                                    setSuiteEditorOpen(true);
                                                }}
                                            >
                                                <Pencil />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                className="text-muted-foreground hover:text-failure"
                                                onClick={async () => {
                                                    if (!confirm(`Delete suite ${s.id}?`)) return;
                                                    await testSuitesApi.remove(s.id);
                                                    refetchSuites();
                                                }}
                                            >
                                                <Trash2 />
                                            </Button>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                </TabsContent>

                {/* ── Reports ── */}
                <TabsContent value="reports">
                    {(reports?.items.length ?? 0) === 0
                        ? (
                            <EmptyState
                                icon={ScrollText}
                                title="No reports yet"
                                description="Run a test suite or master plan to generate reports."
                            />
                        )
                        : (
                            <div className="space-y-2">
                                {reports!.items.map((r) => (
                                    <Link
                                        key={r.id}
                                        to={`/reports/${r.id}`}
                                        className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-accent/40"
                                    >
                                        <StatusBadge status={r.status} />
                                        <TypeBadge type={r.type} />
                                        <span className="truncate font-mono text-sm flex-1">
                                            {r.id}
                                        </span>
                                        {r.type === "MASTER_PLAN" && r.structuredSummary && (
                                            <span className="text-xs font-medium text-muted-foreground shrink-0">
                                                {Math.round(
                                                    r.structuredSummary.overallPassRate <= 1
                                                        ? r.structuredSummary.overallPassRate * 100
                                                        : r.structuredSummary.overallPassRate,
                                                )}% pass
                                            </span>
                                        )}
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {timeAgo(r.createdAt)}
                                        </span>
                                    </Link>
                                ))}
                                <p className="pt-1 text-right text-xs text-muted-foreground">
                                    <Link
                                        to={`/reports?projectId=${project.id}`}
                                        className="hover:text-foreground transition-colors"
                                    >
                                        View all reports →
                                    </Link>
                                </p>
                            </div>
                        )}
                </TabsContent>

                {/* ── Master Plan ── */}
                <TabsContent value="masterplan">
                    <MasterPlanRunner projectId={project.id} />
                </TabsContent>

                {/* ── Execute single goal ── */}
                <TabsContent value="goal">
                    <ExecuteGoalRunner projectId={project.id} />
                </TabsContent>

                {/* ── Files ── */}
                <TabsContent value="files">
                    <div className="mb-3 flex justify-end">
                        <Button size="sm" onClick={() => setAttachOpen(true)}>
                            <Plus /> Attach files
                        </Button>
                    </div>
                    {(project.files?.length ?? 0) === 0
                        ? (
                            <EmptyState
                                icon={FileText}
                                title="No files attached"
                                description="Attach uploaded files to index them into this project's vector collection."
                                action={
                                    <Button size="sm" onClick={() => setAttachOpen(true)}>
                                        <Plus /> Attach files
                                    </Button>
                                }
                            />
                        )
                        : (
                            <div className="space-y-2">
                                {project.files.map((f) => (
                                    <Card key={f.id} className="flex items-center gap-3 px-4 py-3">
                                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{f.filename}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {f.mimetype} · {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                                            </p>
                                        </div>
                                        <a
                                            href={filesApi.downloadUrl(f.id)}
                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                            title="Download"
                                        >
                                            <Download className="size-4" />
                                        </a>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            title="Detach from project"
                                            className="text-muted-foreground hover:text-failure"
                                            onClick={() => removeFile.mutate(f.id)}
                                        >
                                            <Unlink />
                                        </Button>
                                    </Card>
                                ))}
                            </div>
                        )}
                </TabsContent>
            </Tabs>

            {/* Dialogs */}
            <RenameDialog
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                projectId={project.id}
                current={project.projectName}
            />
            <AttachFilesDialog
                open={attachOpen}
                onClose={() => setAttachOpen(false)}
                projectId={project.id}
                attachedIds={new Set(project.files?.map((f) => f.id))}
            />
            <SuiteEditorDialog
                open={suiteEditorOpen}
                onClose={() => setSuiteEditorOpen(false)}
                suite={editingSuite}
                projectId={project.id}
                onDone={refetchSuites}
            />
        </div>
    );
}

// ─── Master Plan Runner ───────────────────────────────────────────────────────

type GoalState = { goal: string; status: "pending" | "running" | "done" | "failed" };

function MasterPlanRunner({ projectId }: { projectId: string }) {
    const [maxGoals, setMaxGoals] = React.useState(5);
    const [initialContext, setInitialContext] = React.useState("{}");
    const [running, setRunning] = React.useState(false);
    const [events, setEvents] = React.useState<PlannerEvent[]>([]);
    const [goals, setGoals] = React.useState<GoalState[]>([]);
    const [reportId, setReportId] = React.useState<string | null>(null);
    const [fatalError, setFatalError] = React.useState<string | null>(null);
    const abortRef = React.useRef<AbortController | null>(null);
    const feedRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }, [events]);

    const handleEvent = (event: PlannerEvent) => {
        setEvents((prev) => [...prev, event]);
        switch (event.type) {
            case "GOALS_GENERATED": {
                const list = (event.goals as string[] | undefined) ?? [];
                setGoals(list.map((goal) => ({ goal, status: "pending" })));
                break;
            }
            case "GOAL_START":
                setGoals((prev) =>
                    prev.map((g) => g.goal === event.goal ? { ...g, status: "running" } : g)
                );
                break;
            case "GOAL_COMPLETE": {
                const failed = typeof event.status === "string" &&
                    event.status.toUpperCase().includes("FAIL");
                setGoals((prev) =>
                    prev.map((g) =>
                        g.goal === event.goal ? { ...g, status: failed ? "failed" : "done" } : g
                    )
                );
                break;
            }
            case "COMPLETE": {
                const report = event.report as { id?: string; _id?: string } | undefined;
                const id = (event.reportId as string | undefined) ?? report?.id ?? report?._id;
                if (id) setReportId(id);
                break;
            }
            case "ERROR":
                setFatalError(String(event.message ?? "Unknown planner error"));
                break;
        }
    };

    const start = async () => {
        setRunning(true);
        setEvents([]);
        setGoals([]);
        setReportId(null);
        setFatalError(null);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await runMasterPlan({ projectId, maxGoals, initialContext }, handleEvent, controller.signal);
        } catch (err) {
            if ((err as Error).name !== "AbortError") setFatalError((err as Error).message);
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Generates developer goals from this project's documentation, executes each in a
                sandbox, and synthesises a quality report.
            </p>

            {/* Config row */}
            <Card className="p-4">
                <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                        <Label>Max goals</Label>
                        <Input
                            type="number"
                            min={1}
                            max={15}
                            value={maxGoals}
                            disabled={running}
                            className="w-24"
                            onChange={(e) => setMaxGoals(Number(e.target.value))}
                        />
                    </div>
                    <div className="flex-1 space-y-1.5 min-w-52">
                        <Label>Initial context (JSON)</Label>
                        <Input
                            value={initialContext}
                            disabled={running}
                            onChange={(e) => setInitialContext(e.target.value)}
                            placeholder='{"apiBase":"http://host.docker.internal:3000/api"}'
                        />
                    </div>
                    <div className="flex gap-2">
                        {running
                            ? (
                                <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
                                    <Square /> Stop
                                </Button>
                            )
                            : (
                                <Button onClick={start}>
                                    <Radar /> Run master plan
                                </Button>
                            )}
                    </div>
                </div>
            </Card>

            {fatalError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">{fatalError}</Card>
            )}

            {reportId && (
                <Card className="flex items-center justify-between border-success/30 bg-success-soft/30 p-4">
                    <span className="flex items-center gap-2 text-sm font-medium">
                        <CheckCircle2 className="size-4 text-success" />
                        Master plan complete.
                    </span>
                    <Link to={`/reports/${reportId}`}>
                        <Button size="sm">Open report</Button>
                    </Link>
                </Card>
            )}

            {goals.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">
                            Goals ({goals.filter((g) => g.status === "done" || g.status === "failed").length}/{goals.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {goals.map((g, i) => (
                            <div key={i} className="flex items-start gap-2.5 text-sm">
                                {g.status === "pending" && <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                                {g.status === "running" && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" />}
                                {g.status === "done" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
                                {g.status === "failed" && <XCircle className="mt-0.5 size-4 shrink-0 text-failure" />}
                                <span className={cn(g.status === "pending" && "text-muted-foreground")}>
                                    {g.goal}
                                </span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="flex-row items-center justify-between pb-3">
                    <CardTitle className="text-sm">Event stream</CardTitle>
                    {running && (
                        <Badge variant="info">
                            <Loader2 className="size-3 animate-spin" /> streaming
                        </Badge>
                    )}
                </CardHeader>
                <CardContent>
                    {events.length === 0
                        ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {running ? "Waiting for events…" : "Start a run to see live events here."}
                            </p>
                        )
                        : (
                            <div
                                ref={feedRef}
                                className="max-h-96 space-y-1.5 overflow-y-auto rounded-md border border-border bg-background/60 p-3 font-mono text-xs"
                            >
                                {events.map((e, i) => <EventLine key={i} event={e} />)}
                            </div>
                        )}
                </CardContent>
            </Card>
        </div>
    );
}

const EVENT_COLOR: Record<string, string> = {
    INIT: "text-info",
    GOALS_GENERATED: "text-accent",
    GOAL_START: "text-info",
    GOAL_PROGRESS: "text-muted-foreground",
    GOAL_COMPLETE: "text-success",
    SUMMARY_GENERATED: "text-accent",
    COMPLETE: "text-success",
    ERROR: "text-failure",
};

function EventLine({ event }: { event: PlannerEvent }) {
    const { type, ...rest } = event;
    const [expanded, setExpanded] = React.useState(false);
    const detail = JSON.stringify(rest);
    const isLong = detail.length > 160;
    const isEmpty = detail === "{}";
    return (
        <div className="leading-relaxed">
            <button
                type="button"
                className={cn("cursor-pointer text-left", isLong && "hover:underline")}
                onClick={() => isLong && setExpanded((x) => !x)}
            >
                <span className={cn("font-semibold", EVENT_COLOR[type] ?? "text-foreground")}>
                    {type}
                </span>
                {!isEmpty && (
                    <span className="text-muted-foreground break-all">
                        {" "}{isLong && !expanded ? `${detail.slice(0, 160)}…` : detail}
                    </span>
                )}
            </button>
            {expanded && (
                <CodeBlock code={JSON.stringify(rest, null, 2)} maxHeight="14rem" className="my-1" wrap />
            )}
        </div>
    );
}

// ─── Execute single goal ──────────────────────────────────────────────────────

function ExecuteGoalRunner({ projectId }: { projectId: string }) {
    const navigate = useNavigate();
    const [goal, setGoal] = React.useState("");
    const [initialContext, setInitialContext] = React.useState("{}");

    const mutation = useMutation({
        mutationFn: async () => {
            // Create a one-off CODE_GENERATION suite, then immediately execute it
            const suite = await testSuitesApi.create({
                projectId,
                mode: "CODE_GENERATION",
                userGoal: goal,
                initialContext,
                minimalStoryLength: 1,
                maximalStoryLength: 5,
            });
            return testSuitesApi.execute(suite.id);
        },
        onSuccess: () => navigate("/jobs"),
    });

    return (
        <div className="max-w-xl space-y-4">
            <p className="text-sm text-muted-foreground">
                Define a one-off goal. A CODE_GENERATION test suite is created and executed
                immediately as a background job.
            </p>

            <div className="space-y-1.5">
                <Label htmlFor="goal-input">Goal</Label>
                <Textarea
                    id="goal-input"
                    rows={3}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Create a program that authenticates a user and fetches their profile."
                />
            </div>

            <div className="space-y-1.5">
                <Label>Initial context (JSON)</Label>
                <Input
                    value={initialContext}
                    onChange={(e) => setInitialContext(e.target.value)}
                    placeholder='{"apiBase":"http://host.docker.internal:3000/api","token":"..."}'
                />
            </div>

            {mutation.isError && (
                <p className="text-sm text-failure">{(mutation.error as Error).message}</p>
            )}

            <Button
                onClick={() => mutation.mutate()}
                disabled={!goal.trim() || mutation.isPending}
            >
                {mutation.isPending
                    ? <><Loader2 className="size-4 animate-spin" /> Creating job…</>
                    : <><Zap /> Execute goal</>}
            </Button>
        </div>
    );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function RenameDialog({ open, onClose, projectId, current }: {
    open: boolean; onClose: () => void; projectId: string; current: string;
}) {
    const [name, setName] = React.useState(current);
    const queryClient = useQueryClient();
    React.useEffect(() => setName(current), [current, open]);

    const mutation = useMutation({
        mutationFn: () => projectsApi.update(projectId, { projectName: name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["project", projectId] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            onClose();
        },
    });

    return (
        <Dialog open={open} onClose={onClose} title="Rename project">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
                <div className="space-y-2">
                    <Label htmlFor="rename">Project name</Label>
                    <Input
                        id="rename"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
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
                        {mutation.isPending ? "Saving…" : "Save"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function AttachFilesDialog({ open, onClose, projectId, attachedIds }: {
    open: boolean; onClose: () => void; projectId: string; attachedIds: Set<string>;
}) {
    const [selected, setSelected] = React.useState("");
    const queryClient = useQueryClient();

    const { data: files } = useQuery({
        queryKey: ["files-all"],
        queryFn: () => filesApi.list(1, 100),
        enabled: open,
    });

    const available = files?.files.filter((f) => !attachedIds.has(f.id)) ?? [];

    const mutation = useMutation({
        mutationFn: () => projectsApi.addFiles(projectId, [selected]),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["project", projectId] });
            setSelected("");
            onClose();
        },
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Attach a file"
            description="The file is chunked and indexed into this project's vector collection."
        >
            <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); if (selected) mutation.mutate(); }}
            >
                <div className="space-y-2">
                    <Label>Uploaded file</Label>
                    <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                        <option value="">Select a file…</option>
                        {available.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.filename} ({shortId(f.id)})
                            </option>
                        ))}
                    </Select>
                    {available.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            No unattached files — upload on the Files page first.
                        </p>
                    )}
                </div>
                {mutation.isError && (
                    <p className="text-sm text-failure">{(mutation.error as Error).message}</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={!selected || mutation.isPending}>
                        {mutation.isPending ? "Indexing…" : "Attach & index"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function SuiteEditorDialog({ open, onClose, suite, projectId, onDone }: {
    open: boolean; onClose: () => void; suite: TestSuite | null; projectId: string;
    onDone: () => void;
}) {
    const [form, setForm] = React.useState<CreateTestSuite>(() => emptyForm(projectId));

    React.useEffect(() => {
        if (!open) return;
        setForm(suite
            ? {
                projectId: suite.projectId,
                mode: suite.mode,
                initialContext: suite.initialContext,
                functionTemplate: suite.functionTemplate,
                userGoal: suite.userGoal,
                minimalStoryLength: suite.minimalStoryLength,
                maximalStoryLength: suite.maximalStoryLength,
            }
            : emptyForm(projectId));
    }, [open, suite, projectId]);

    const mutation = useMutation({
        mutationFn: () =>
            suite ? testSuitesApi.update(suite.id, form) : testSuitesApi.create(form),
        onSuccess: () => { onDone(); onClose(); },
    });

    const set = <K extends keyof CreateTestSuite>(key: K, value: CreateTestSuite[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={suite ? `Edit suite` : "New test suite"}
            className="max-w-2xl"
        >
            <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
            >
                <div className="space-y-2">
                    <Label>Mode</Label>
                    <Select
                        value={form.mode}
                        onChange={(e) => set("mode", e.target.value as TestSuiteMode)}
                    >
                        <option value="TEST_SCENARIO">TEST_SCENARIO</option>
                        <option value="CODE_GENERATION">CODE_GENERATION</option>
                    </Select>
                </div>

                {form.mode === "CODE_GENERATION" && (
                    <div className="space-y-2">
                        <Label>User goal</Label>
                        <Textarea
                            value={form.userGoal ?? ""}
                            onChange={(e) => set("userGoal", e.target.value)}
                            placeholder="Create a program that registers a user and fetches their profile."
                        />
                    </div>
                )}

                {form.mode === "TEST_SCENARIO" && (
                    <div className="space-y-2">
                        <Label>Function template</Label>
                        <Textarea
                            value={form.functionTemplate ?? ""}
                            onChange={(e) => set("functionTemplate", e.target.value)}
                            placeholder="function createOrder(context, items) { /* ... */ }"
                        />
                    </div>
                )}

                <div className="space-y-2">
                    <Label>Initial context (JSON)</Label>
                    <Textarea
                        value={form.initialContext}
                        onChange={(e) => set("initialContext", e.target.value)}
                        placeholder='{"apiBase":"http://host.docker.internal:3000/api","token":"..."}'
                        required
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Min steps</Label>
                        <Input
                            type="number" min={1}
                            value={form.minimalStoryLength}
                            onChange={(e) => set("minimalStoryLength", Number(e.target.value))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Max steps</Label>
                        <Input
                            type="number" min={1}
                            value={form.maximalStoryLength}
                            onChange={(e) => set("maximalStoryLength", Number(e.target.value))}
                        />
                    </div>
                </div>

                {mutation.isError && (
                    <p className="text-sm text-failure">{(mutation.error as Error).message}</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={mutation.isPending}>
                        {mutation.isPending ? "Saving…" : suite ? "Save changes" : "Create suite"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function emptyForm(projectId: string): CreateTestSuite {
    return {
        projectId,
        mode: "TEST_SCENARIO",
        initialContext: "{}",
        functionTemplate: "",
        userGoal: "",
        minimalStoryLength: 3,
        maximalStoryLength: 8,
    };
}
