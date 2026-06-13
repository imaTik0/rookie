import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    AlertTriangle,
    ArrowLeft,
    Braces,
    CheckCircle2,
    Clock,
    FileDiff,
    FileWarning,
    FlaskConical,
    Gauge,
    Lightbulb,
    ListChecks,
    ListOrdered,
    MapPin,
    ScrollText,
    Target,
    Terminal,
    ThumbsDown,
    ThumbsUp,
    Trash2,
    Waves,
    Wrench,
    XCircle,
} from "lucide-react";
import { reportsApi } from "@/lib/api";
import type {
    FailureAnalysis,
    GapFeedback,
    Report,
    StepResult,
    StructuredMasterSummary,
} from "@/lib/types";
import { formatDate, formatDuration, tryPrettyJson } from "@/lib/format";
import { StatusBadge, TypeBadge, GapBadge } from "@/components/shared/StatusBadge";
import { CodeBlock, CopyButton } from "@/components/shared/CodeBlock";
import { Markdown } from "@/components/shared/Markdown";
import { Collapsible } from "@/components/shared/Collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function ReportDetailPage() {
    const { reportId } = useParams<{ reportId: string }>();
    const navigate = useNavigate();

    const { data: report, isLoading, isError, error } = useQuery({
        queryKey: ["report", reportId],
        queryFn: () => reportsApi.get(reportId!),
        enabled: !!reportId,
    });

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-24" />
                <Skeleton className="h-64" />
            </div>
        );
    }

    if (isError || !report) {
        return (
            <Card className="border-failure/30 p-6 text-sm">
                <p className="text-failure">
                    {(error as Error)?.message ?? "Report not found."}
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/reports")}>
                    <ArrowLeft /> Back to reports
                </Button>
            </Card>
        );
    }

    const steps: StepResult[] = report.steps?.length
        ? report.steps
        : report.detailedResults?.steps ?? [];
    const durationMs = report.durationMs ?? report.detailedResults?.durationMs;
    const finalOutput = report.detailedResults?.finalOutput;
    const initialContext = report.initialContext || report.detailedResults?.initialContext || "";
    const executionPlan = report.executionPlan ?? report.detailedResults?.executionPlan;
    const passed = steps.filter((s) => s.status === "SUCCESS").length;

    const onDelete = async () => {
        if (!confirm("Delete this report? This cannot be undone.")) return;
        await reportsApi.remove(report.id);
        navigate("/reports");
    };

    return (
        <div>
            <Link
                to="/reports"
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> Reports
            </Link>

            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="font-mono text-lg font-semibold tracking-tight">
                            {report.id}
                        </h1>
                        <CopyButton text={report.id} />
                        <TypeBadge type={report.type} />
                        <StatusBadge status={report.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5" /> {formatDate(report.createdAt)}
                        </span>
                        {durationMs !== undefined && (
                            <span>duration {formatDuration(durationMs)}</span>
                        )}
                        {steps.length > 0 && (
                            <span>
                                {passed}/{steps.length} steps passed
                            </span>
                        )}
                        {report.projectId && (
                            <Link
                                to={`/projects/${report.projectId}`}
                                className="text-info hover:underline"
                            >
                                project ↗
                            </Link>
                        )}
                        {report.testSuiteId && (
                            <Link
                                to={`/testsuites?projectId=${report.projectId}`}
                                className="text-info hover:underline"
                            >
                                test suite ↗
                            </Link>
                        )}
                        {report.masterPlanId && report.type !== "MASTER_PLAN" && (
                            <span className="font-mono">plan {report.masterPlanId}</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {(report.type === "MASTER_PLAN" ||
                        steps.some((s) => s.failureAnalysis)) && (
                        <a
                            href={reportsApi.docsPatchUrl(report.id, "markdown")}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Button variant="outline" size="sm" title="Aggregated documentation fix proposal">
                                <FileDiff /> Docs patch
                            </Button>
                        </a>
                    )}
                    <Button variant="destructive" size="sm" onClick={onDelete}>
                        <Trash2 /> Delete
                    </Button>
                </div>
            </div>

            {report.type === "MASTER_PLAN" && report.structuredSummary
                ? <MasterPlanView report={report} summary={report.structuredSummary} steps={steps} />
                : (
                    <StandardReportView
                        report={report}
                        steps={steps}
                        finalOutput={finalOutput}
                        initialContext={initialContext}
                        executionPlan={executionPlan}
                    />
                )}
        </div>
    );
}

/* ------------------------------ standard view ------------------------------ */

function StandardReportView({
    report,
    steps,
    finalOutput,
    initialContext,
    executionPlan,
}: {
    report: Report;
    steps: StepResult[];
    finalOutput?: string;
    initialContext: string;
    executionPlan: unknown;
}) {
    const hasPlan = executionPlan !== undefined && executionPlan !== null;
    const coverage = report.coverageReport ?? [];
    const friction = report.frictionEvents ?? [];
    return (
        <Tabs defaultValue={steps.length > 0 ? "steps" : finalOutput ? "output" : "raw"}>
            <TabsList>
                {steps.length > 0 && (
                    <TabsTrigger value="steps">
                        <ListOrdered className="size-3.5" /> Steps ({steps.length})
                    </TabsTrigger>
                )}
                {coverage.length > 0 && (
                    <TabsTrigger value="coverage">
                        <ListChecks className="size-3.5" /> Coverage (
                        {coverage.filter((c) => c.covered).length}/{coverage.length})
                    </TabsTrigger>
                )}
                {friction.length > 0 && (
                    <TabsTrigger value="friction">
                        <Waves className="size-3.5" /> Friction ({friction.length})
                    </TabsTrigger>
                )}
                {finalOutput && (
                    <TabsTrigger value="output">
                        <ScrollText className="size-3.5" /> Final output
                    </TabsTrigger>
                )}
                {hasPlan && (
                    <TabsTrigger value="plan">
                        <Target className="size-3.5" /> Plan
                    </TabsTrigger>
                )}
                {initialContext && (
                    <TabsTrigger value="context">
                        <Braces className="size-3.5" /> Context
                    </TabsTrigger>
                )}
                <TabsTrigger value="raw">
                    <Terminal className="size-3.5" /> Raw
                </TabsTrigger>
            </TabsList>

            {steps.length > 0 && (
                <TabsContent value="steps">
                    <StepsTimeline
                        steps={steps}
                        reportId={report.id}
                        feedback={report.gapFeedback}
                    />
                </TabsContent>
            )}

            {coverage.length > 0 && (
                <TabsContent value="coverage">
                    <Card className="divide-y divide-border">
                        {coverage.map((item, i) => (
                            <div key={i} className="flex items-start gap-3 p-4">
                                {item.covered
                                    ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                                    : <XCircle className="mt-0.5 size-4 shrink-0 text-failure" />}
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">{item.subtask}</p>
                                    {item.missingInfo && (
                                        <p className="mt-1 text-sm text-failure/90">
                                            {item.missingInfo}
                                        </p>
                                    )}
                                    {!!item.queriesUsed?.length && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            queries:{" "}
                                            {item.queriesUsed.map((q) => `"${q}"`).join(", ")}
                                        </p>
                                    )}
                                </div>
                                <Badge variant={item.covered ? "success" : "failure"}>
                                    {item.covered ? "covered" : "gap"}
                                </Badge>
                            </div>
                        ))}
                    </Card>
                    <p className="mt-2 text-xs text-muted-foreground">
                        The research agent's per-subtask documentation coverage. Uncovered
                        subtasks are documentation gaps even when the run ultimately passed.
                    </p>
                </TabsContent>
            )}

            {friction.length > 0 && (
                <TabsContent value="friction">
                    <div className="space-y-2">
                        {friction.map((event, i) => (
                            <Card key={i} className="p-4">
                                <div className="mb-2 flex items-center gap-2">
                                    <Badge
                                        variant={event.type === "SMOKE_TEST_FAILURE"
                                            ? "warning"
                                            : "info"}
                                    >
                                        {event.type === "SMOKE_TEST_FAILURE"
                                            ? "smoke test failed"
                                            : "research bounce"}
                                    </Badge>
                                    {event.query && (
                                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                            {event.query}
                                        </code>
                                    )}
                                </div>
                                {event.note && (
                                    <p className="text-sm text-muted-foreground">{event.note}</p>
                                )}
                                {event.error && (
                                    <CodeBlock code={event.error} wrap maxHeight="10rem" className="mt-2" />
                                )}
                            </Card>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            Friction the agent hit mid-run — signals of unclear documentation
                            that a binary pass/fail hides.
                        </p>
                    </div>
                </TabsContent>
            )}

            {finalOutput && (
                <TabsContent value="output">
                    <Card>
                        <CardContent className="pt-5">
                            <Markdown>{finalOutput}</Markdown>
                        </CardContent>
                    </Card>
                </TabsContent>
            )}

            {hasPlan && (
                <TabsContent value="plan">
                    <CodeBlock
                        label="Execution plan"
                        code={tryPrettyJson(executionPlan)}
                        maxHeight="40rem"
                    />
                </TabsContent>
            )}

            {initialContext && (
                <TabsContent value="context">
                    <CodeBlock
                        label="Initial context"
                        code={tryPrettyJson(initialContext)}
                        maxHeight="40rem"
                    />
                </TabsContent>
            )}

            <TabsContent value="raw">
                <CodeBlock label="Report JSON" code={tryPrettyJson(report)} maxHeight="44rem" />
            </TabsContent>
        </Tabs>
    );
}

function StepsTimeline({
    steps,
    reportId,
    feedback,
}: {
    steps: StepResult[];
    reportId?: string;
    feedback?: GapFeedback[];
}) {
    return (
        <ol className="relative space-y-3 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-border">
            {steps.map((step, i) => (
                <StepCard key={i} step={step} reportId={reportId} feedback={feedback} />
            ))}
        </ol>
    );
}

function StepCard({
    step,
    reportId,
    feedback,
}: {
    step: StepResult;
    reportId?: string;
    feedback?: GapFeedback[];
}) {
    const failed = step.status === "FAILED";
    const [open, setOpen] = React.useState(failed);
    return (
        <li className="relative pl-10">
            <span
                className={cn(
                    "absolute left-0 top-3 flex size-8 items-center justify-center rounded-full border bg-card",
                    failed ? "border-failure/40 text-failure" : "border-success/40 text-success",
                )}
            >
                {failed ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
            </span>
            <Card className={cn(failed && "border-failure/30")}>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
                >
                    <span className="font-mono text-xs text-muted-foreground">
                        #{step.stepIndex}
                    </span>
                    <span className="flex-1 text-sm font-medium">{step.stepDescription}</span>
                    <StatusBadge status={step.status} />
                </button>
                {open && (
                    <div className="space-y-3 border-t border-border p-4">
                        {step.scriptContent && (
                            <CodeBlock label="Generated code" code={step.scriptContent} />
                        )}
                        {step.logs && (
                            <CodeBlock label="Logs (stdout / stderr)" code={step.logs} wrap />
                        )}
                        {step.error && (
                            <CodeBlock
                                label="Error"
                                code={tryPrettyJson(step.error)}
                                wrap
                                className="border-failure/30"
                            />
                        )}
                        {(step.httpTrafficLog?.length ?? 0) > 0 && (
                            <Collapsible title={`HTTP traffic (${step.httpTrafficLog!.length} request${step.httpTrafficLog!.length !== 1 ? "s" : ""})`}>
                                <div className="space-y-1.5 font-mono text-xs">
                                    {step.httpTrafficLog!.map((e, idx) => (
                                        <div key={idx} className={cn(
                                            "rounded px-2 py-1.5",
                                            e.error ? "bg-failure/10 text-failure"
                                                : (e.responseStatus ?? 0) >= 400 ? "bg-warning/10"
                                                : "bg-muted/60",
                                        )}>
                                            <span className="font-semibold">{e.method}</span>{" "}
                                            <span className="opacity-80">{e.url}</span>
                                            {e.responseStatus != null && (
                                                <span className={cn(
                                                    "ml-2 font-semibold",
                                                    e.responseStatus >= 400 ? "text-warning" : "text-success",
                                                )}>
                                                    → {e.responseStatus}
                                                </span>
                                            )}
                                            {e.error && <span className="ml-2 text-failure">ERR: {e.error}</span>}
                                            {e.durationMs != null && (
                                                <span className="ml-2 text-muted-foreground">{e.durationMs}ms</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </Collapsible>
                        )}
                        {step.failureAnalysis && (
                            <FailureAnalysisCard
                                analysis={step.failureAnalysis}
                                reportId={reportId}
                                stepIndex={step.stepIndex}
                                feedback={feedback?.filter((f) =>
                                    f.stepIndex === step.stepIndex
                                )}
                            />
                        )}
                        {step.contextAfter !== undefined && step.contextAfter !== null && (
                            <Collapsible title="Context after step">
                                <CodeBlock code={tryPrettyJson(step.contextAfter)} />
                            </Collapsible>
                        )}
                        {!!step.relatedKnowledge?.length && (
                            <Collapsible
                                title="Related documentation"
                                badge={<Badge variant="muted">{step.relatedKnowledge.length}</Badge>}
                            >
                                <CodeBlock code={tryPrettyJson(step.relatedKnowledge)} />
                            </Collapsible>
                        )}
                    </div>
                )}
            </Card>
        </li>
    );
}

function VerificationBadge({ analysis }: { analysis: FailureAnalysis }) {
    const v = analysis.fragmentVerification;
    if (!v) return null;
    if (v.verified) {
        return (
            <Badge variant="success" title={`Match score ${v.matchScore}`}>
                <MapPin className="size-3" />
                {v.file}
                {v.lineStart ? `:${v.lineStart}` : ""}
            </Badge>
        );
    }
    return (
        <Badge variant="warning" title="The quoted fragment could not be located in the documentation corpus">
            <MapPin className="size-3" /> unverified quote
        </Badge>
    );
}

function ConfidenceBadge({ analysis }: { analysis: FailureAnalysis }) {
    if (analysis.confidence === undefined) return null;
    const pct = Math.round(analysis.confidence * 100);
    const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "failure";
    return (
        <Badge
            variant={variant}
            title={analysis.votes ? `${analysis.votes} classifier votes` : undefined}
        >
            <Gauge className="size-3" /> {pct}%
        </Badge>
    );
}

function GapFeedbackButtons({
    reportId,
    stepIndex,
    feedback,
}: {
    reportId: string;
    stepIndex: number;
    feedback?: GapFeedback[];
}) {
    const queryClient = useQueryClient();
    const existing = feedback?.[feedback.length - 1];
    const mutation = useMutation({
        mutationFn: (verdict: "ACCEPTED" | "REJECTED") =>
            reportsApi.addFeedback(reportId, { stepIndex, verdict }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["report", reportId] }),
    });

    if (existing) {
        return (
            <Badge variant={existing.verdict === "ACCEPTED" ? "success" : "failure"}>
                fix {existing.verdict.toLowerCase()}
            </Badge>
        );
    }
    return (
        <span className="ml-auto inline-flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Proposed fix:</span>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Accept proposed fix"
                disabled={mutation.isPending}
                className="text-muted-foreground hover:text-success"
                onClick={() => mutation.mutate("ACCEPTED")}
            >
                <ThumbsUp />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Reject proposed fix"
                disabled={mutation.isPending}
                className="text-muted-foreground hover:text-failure"
                onClick={() => mutation.mutate("REJECTED")}
            >
                <ThumbsDown />
            </Button>
        </span>
    );
}

function FailureAnalysisCard({
    analysis,
    reportId,
    stepIndex,
    feedback,
}: {
    analysis: NonNullable<StepResult["failureAnalysis"]>;
    reportId?: string;
    stepIndex?: number;
    feedback?: GapFeedback[];
}) {
    return (
        <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <AlertTriangle className="size-4 text-warning" />
                <span className="text-sm font-semibold">Failure analysis</span>
                <GapBadge gap={analysis.documentationGap} />
                <ConfidenceBadge analysis={analysis} />
                <VerificationBadge analysis={analysis} />
                {analysis.failedFunction && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {analysis.failedFunction}
                    </code>
                )}
                {reportId !== undefined && stepIndex !== undefined && (
                    <GapFeedbackButtons
                        reportId={reportId}
                        stepIndex={stepIndex}
                        feedback={feedback}
                    />
                )}
            </div>
            <div className="space-y-3 text-sm">
                {analysis.errorMessage && (
                    <p className="font-mono text-xs text-failure">{analysis.errorMessage}</p>
                )}
                {analysis.reasoning && (
                    <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Reasoning
                        </p>
                        <p className="text-foreground/90">{analysis.reasoning}</p>
                    </div>
                )}
                {analysis.suggestedDocsFix && (
                    <div>
                        <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            <Wrench className="size-3" /> Suggested docs fix
                        </p>
                        <p className="text-foreground/90">{analysis.suggestedDocsFix}</p>
                    </div>
                )}
                {(analysis.pinpointedFragment || analysis.proposedFragment) && (
                    <div className="grid gap-3 md:grid-cols-2">
                        {analysis.pinpointedFragment && (
                            <CodeBlock
                                label={analysis.fragmentVerification?.verified
                                    ? `Current fragment (verified, ${analysis.fragmentVerification.file})`
                                    : "Current fragment (LLM quote, unverified)"}
                                code={analysis.fragmentVerification?.matchedText ??
                                    analysis.pinpointedFragment}
                                wrap
                                className="border-failure/30"
                            />
                        )}
                        {analysis.proposedFragment && (
                            <CodeBlock
                                label="Proposed fragment"
                                code={analysis.proposedFragment}
                                wrap
                                className="border-success/30"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ----------------------------- master plan view ---------------------------- */

/** Backend stores pass rate as a 0..1 float; tolerate 0..100 too. */
export function passRatePct(rate: number): number {
    return rate <= 1 ? rate * 100 : rate;
}

function PassRateRing({ rate }: { rate: number }) {
    const clamped = Math.max(0, Math.min(100, passRatePct(rate)));
    const r = 34;
    const c = 2 * Math.PI * r;
    const color = clamped >= 80
        ? "var(--color-success)"
        : clamped >= 50
        ? "var(--color-warning)"
        : "var(--color-failure)";
    return (
        <div className="relative size-24">
            <svg viewBox="0 0 80 80" className="size-24 -rotate-90">
                <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="7" />
                <circle
                    cx="40"
                    cy="40"
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - clamped / 100)}
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold">
                {Math.round(clamped)}%
            </span>
        </div>
    );
}

function MasterPlanView({
    report,
    summary,
    steps,
}: {
    report: Report;
    summary: StructuredMasterSummary;
    steps: StepResult[];
}) {
    const taxonomy = Object.entries(summary.failureTaxonomy ?? {}).sort((a, b) => b[1] - a[1]);
    const goals = summary.goalsBreakdown ?? [];

    return (
        <div className="space-y-6">
            {/* Overview row */}
            <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
                <Card className="flex items-center gap-5 p-5">
                    <PassRateRing rate={summary.overallPassRate} />
                    <div>
                        <p className="text-sm font-medium">Overall pass rate</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {goals.length} goals evaluated
                        </p>
                        {taxonomy.length > 0 && (
                            <div className="mt-3 flex max-w-60 flex-wrap gap-1.5">
                                {taxonomy.map(([gap, count]) => (
                                    <span key={gap} className="inline-flex items-center gap-1">
                                        <GapBadge gap={gap} />
                                        <span className="text-xs text-muted-foreground">×{count}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <ScrollText className="size-4 text-accent" /> Executive summary
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Markdown>{summary.executiveSummary}</Markdown>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="goals">
                <TabsList>
                    <TabsTrigger value="goals">
                        <Target className="size-3.5" /> Goals ({goals.length})
                    </TabsTrigger>
                    {(summary.documentationGapDetails?.length ?? 0) > 0 && (
                        <TabsTrigger value="gaps">
                            <FileWarning className="size-3.5" /> Doc gaps (
                            {summary.documentationGapDetails.length})
                        </TabsTrigger>
                    )}
                    {(summary.recommendations?.length ?? 0) > 0 && (
                        <TabsTrigger value="recs">
                            <Lightbulb className="size-3.5" /> Recommendations
                        </TabsTrigger>
                    )}
                    {(summary.topFailingFunctions?.length ?? 0) > 0 && (
                        <TabsTrigger value="functions">
                            <FlaskConical className="size-3.5" /> Failing functions
                        </TabsTrigger>
                    )}
                    {steps.length > 0 && (
                        <TabsTrigger value="steps">
                            <ListOrdered className="size-3.5" /> Steps
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="raw">
                        <Terminal className="size-3.5" /> Raw
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="goals">
                    <div className="space-y-2">
                        {goals.map((g, i) => (
                            <Card key={i} className="p-4">
                                <div className="flex flex-wrap items-start gap-3">
                                    <StatusBadge status={g.status} className="mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">{g.goal}</p>
                                        {g.keyFindings && (
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {g.keyFindings}
                                            </p>
                                        )}
                                    </div>
                                    {g.reportId && (
                                        <Link
                                            to={`/reports/${g.reportId}`}
                                            className="shrink-0 text-xs text-info hover:underline"
                                        >
                                            View report →
                                        </Link>
                                    )}
                                </div>
                            </Card>
                        ))}
                        {report.masterPlanReports && report.masterPlanReports.length > 0 && (
                            <>
                                <Separator className="my-4" />
                                <p className="text-xs text-muted-foreground">
                                    Child reports:{" "}
                                    {report.masterPlanReports.map((id, i) => (
                                        <React.Fragment key={id}>
                                            {i > 0 && ", "}
                                            <Link
                                                to={`/reports/${id}`}
                                                className="font-mono text-info hover:underline"
                                            >
                                                {id}
                                            </Link>
                                        </React.Fragment>
                                    ))}
                                </p>
                            </>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="gaps">
                    <div className="space-y-3">
                        {summary.documentationGapDetails?.map((gap, i) => (
                            <Card key={i} className="p-4">
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                    <FileWarning className="size-4 text-warning" />
                                    {gap.documentationGap && <GapBadge gap={gap.documentationGap} />}
                                    {gap.verified === true && gap.file && (
                                        <Badge variant="success">
                                            <MapPin className="size-3" />
                                            {gap.file}
                                            {gap.lineStart ? `:${gap.lineStart}` : ""}
                                        </Badge>
                                    )}
                                    {gap.verified === false && (
                                        <Badge variant="warning">
                                            <MapPin className="size-3" /> unverified
                                        </Badge>
                                    )}
                                    {gap.verified === undefined && gap.file && (
                                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                            {gap.file}
                                        </code>
                                    )}
                                    {gap.occurrences !== undefined && gap.occurrences > 1 && (
                                        <Badge variant="muted">×{gap.occurrences}</Badge>
                                    )}
                                    {gap.meanConfidence !== undefined && (
                                        <Badge variant="outline">
                                            <Gauge className="size-3" />{" "}
                                            {Math.round(gap.meanConfidence * 100)}%
                                        </Badge>
                                    )}
                                    {gap.regressionStatus && (
                                        <Badge
                                            variant={
                                                gap.regressionStatus === "NEW" ? "failure"
                                                : gap.regressionStatus === "PERSISTED" ? "warning"
                                                : "success"
                                            }
                                        >
                                            {gap.regressionStatus === "NEW" ? "🆕 new"
                                                : gap.regressionStatus === "PERSISTED" ? "↩ persisted"
                                                : "✓ resolved"}
                                        </Badge>
                                    )}
                                    {(gap.affectedGoals?.length ?? 0) > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                            affects {gap.affectedGoals.length} goal(s)
                                        </span>
                                    )}
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <CodeBlock
                                        label="Documentation fragment"
                                        code={gap.fragment}
                                        wrap
                                        className="border-failure/30"
                                    />
                                    <CodeBlock
                                        label="Proposed fix"
                                        code={gap.proposedFix}
                                        wrap
                                        className="border-success/30"
                                    />
                                </div>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="recs">
                    <Card className="p-5">
                        <ul className="space-y-3">
                            {summary.recommendations?.map((rec, i) => (
                                <li key={i} className="flex gap-3 text-sm">
                                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                                    <span className="text-foreground/90">{rec}</span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </TabsContent>

                <TabsContent value="functions">
                    <div className="space-y-2">
                        {summary.topFailingFunctions?.map((fn, i) => (
                            <Card key={i} className="flex items-center gap-4 p-4">
                                <Badge variant="failure">×{fn.count}</Badge>
                                <code className="font-mono text-sm">{fn.functionName}</code>
                                <span className="ml-auto truncate text-xs text-muted-foreground">
                                    {fn.goals?.join(" · ")}
                                </span>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {steps.length > 0 && (
                    <TabsContent value="steps">
                        <StepsTimeline
                            steps={steps}
                            reportId={report.id}
                            feedback={report.gapFeedback}
                        />
                    </TabsContent>
                )}

                <TabsContent value="raw">
                    <CodeBlock label="Report JSON" code={tryPrettyJson(report)} maxHeight="44rem" />
                </TabsContent>
            </Tabs>
        </div>
    );
}
