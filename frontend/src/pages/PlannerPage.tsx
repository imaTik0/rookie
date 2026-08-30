import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Loader2, Radar, Square, XCircle } from "lucide-react";
import { projectsApi, runMasterPlan } from "@/lib/api";
import type { PlannerEvent } from "@/lib/types";
import { PageHeader } from "@/components/shared/PageHeader";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GoalState = { goal: string; status: "pending" | "running" | "done" | "failed" };

export function PlannerPage() {
    const [projectId, setProjectId] = React.useState("");
    const [maxGoals, setMaxGoals] = React.useState(5);
    const [initialContext, setInitialContext] = React.useState("{}");

    const [running, setRunning] = React.useState(false);
    const [events, setEvents] = React.useState<PlannerEvent[]>([]);
    const [goals, setGoals] = React.useState<GoalState[]>([]);
    const [reportId, setReportId] = React.useState<string | null>(null);
    const [fatalError, setFatalError] = React.useState<string | null>(null);
    const abortRef = React.useRef<AbortController | null>(null);
    const feedRef = React.useRef<HTMLDivElement>(null);

    const { data: projects } = useQuery({
        queryKey: ["projects-all"],
        queryFn: () => projectsApi.list(1, 100),
    });

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
            await runMasterPlan(
                { projectId, maxGoals, initialContext },
                handleEvent,
                controller.signal,
            );
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                setFatalError((err as Error).message);
            }
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const stop = () => abortRef.current?.abort();

    return (
        <div>
            <PageHeader
                title="Master Planner"
                description="Generates realistic developer goals from a project's documentation, executes each one in a sandbox, and synthesises a master report."
            />

            <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
                {/* Config */}
                <Card className="h-fit">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <Radar className="size-4 text-accent" /> Run configuration
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Project</Label>
                            <Select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                disabled={running}
                            >
                                <option value="">Select project…</option>
                                {projects?.projects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.projectName}</option>
                                ))}
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Max goals (1–15)</Label>
                            <Input
                                type="number"
                                min={1}
                                max={15}
                                value={maxGoals}
                                disabled={running}
                                onChange={(e) => setMaxGoals(Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Initial context (JSON string)</Label>
                            <Textarea
                                rows={4}
                                value={initialContext}
                                disabled={running}
                                onChange={(e) => setInitialContext(e.target.value)}
                                placeholder='{"apiBase":"http://host.docker.internal:14000/api/v1","token":"..."}'
                            />
                        </div>
                        {running
                            ? (
                                <Button variant="destructive" className="w-full" onClick={stop}>
                                    <Square /> Stop stream
                                </Button>
                            )
                            : (
                                <Button className="w-full" disabled={!projectId} onClick={start}>
                                    <Radar /> Run master plan
                                </Button>
                            )}
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Long-running: duration scales with the number of goals and
                            model/sandbox latency. Stopping the stream only detaches this view.
                        </p>
                    </CardContent>
                </Card>

                {/* Live view */}
                <div className="space-y-4">
                    {fatalError && (
                        <Card className="border-failure/30 p-4 text-sm text-failure">
                            {fatalError}
                        </Card>
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
                                    Goals ({goals.filter((g) => g.status === "done").length +
                                        goals.filter((g) => g.status === "failed").length}/
                                    {goals.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {goals.map((g, i) => (
                                    <div key={i} className="flex items-start gap-2.5 text-sm">
                                        {g.status === "pending" && (
                                            <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                        )}
                                        {g.status === "running" && (
                                            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" />
                                        )}
                                        {g.status === "done" && (
                                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                                        )}
                                        {g.status === "failed" && (
                                            <XCircle className="mt-0.5 size-4 shrink-0 text-failure" />
                                        )}
                                        <span
                                            className={cn(
                                                g.status === "pending" && "text-muted-foreground",
                                            )}
                                        >
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
                                        {running
                                            ? "Waiting for events…"
                                            : "Run the planner to see live NDJSON events here."}
                                    </p>
                                )
                                : (
                                    <div
                                        ref={feedRef}
                                        className="max-h-[28rem] space-y-1.5 overflow-y-auto rounded-md border border-border bg-background/80 p-3 font-mono text-xs"
                                    >
                                        {events.map((e, i) => <EventLine key={i} event={e} />)}
                                    </div>
                                )}
                        </CardContent>
                    </Card>
                </div>
            </div>
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
                <CodeBlock
                    code={JSON.stringify(rest, null, 2)}
                    maxHeight="14rem"
                    className="my-1"
                    wrap
                />
            )}
        </div>
    );
}
