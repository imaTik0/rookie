import { useEffect, useState, useRef } from "react";
import { BrainCircuit, Play, CheckCircle2, XCircle, Loader2, ListTodo, FileText } from "lucide-react";
import { marked } from "marked";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";

type GoalStatus = "WAITING" | "RUNNING" | "SUCCESS" | "FAILED";

interface ExecutionGoal {
    title: string;
    status: GoalStatus;
    logs: string[];
    reportId: string | null;
}

export default function MasterPlanner() {
    const [projects, setProjects] = useState<{ id: string; projectName: string }[]>([]);
    const [projectId, setProjectId] = useState("");
    const [maxGoals, setMaxGoals] = useState<number>(5);
    const [initialContext, setInitialContext] = useState<string>("{}");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Streaming State
    const [goals, setGoals] = useState<ExecutionGoal[]>([]);
    const [currentGoalIndex, setCurrentGoalIndex] = useState<number>(-1);
    const [finalSummary, setFinalSummary] = useState("");
    const [masterPlanId, setMasterPlanId] = useState<string | null>(null);
    const [isComplete, setIsComplete] = useState(false);

    const scrollRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

    useEffect(() => {
        fetch("http://localhost:3000/projects")
            .then((res) => res.json())
            .then((data) => {
                setProjects(data.projects || []);
                if (data.projects?.length > 0) {
                    setProjectId(data.projects[0].id);
                }
            });
    }, []);

    const scrollToBottom = (index: number) => {
        if (scrollRefs.current[index]) {
            scrollRefs.current[index]?.scrollIntoView({ behavior: "smooth" });
        }
    };

    const handleRunMasterPlan = async () => {
        setLoading(true);
        setError("");
        setGoals([]);
        setCurrentGoalIndex(-1);
        setFinalSummary("");
        setMasterPlanId(null);
        setIsComplete(false);

        try {
            const res = await fetch("http://localhost:3000/planner/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId, maxGoals, initialContext }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: res.statusText }));
                setError(errData.message || "Failed to start Master Plan");
                setLoading(false);
                return;
            }

            if (!res.body) {
                setError("Readable stream not supported");
                setLoading(false);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep the incomplete line in the buffer

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        handleStreamEvent(event);
                    } catch (err) {
                        console.error("Failed to parse stream line:", line, err);
                    }
                }
            }
            // Parse any remaining buffer
            if (buffer.trim()) {
                try {
                    const event = JSON.parse(buffer);
                    handleStreamEvent(event);
                } catch (err) {
                    // Ignore final parsing error
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unknown error occurred");
        } finally {
            setLoading(false);
            setIsComplete(true);
        }
    };

    const handleStreamEvent = (event: any) => {
        switch (event.type) {
            case "GOALS_GENERATED":
                setGoals(
                    event.goals.map((g: string) => ({
                        title: g,
                        status: "WAITING",
                        logs: [],
                        reportId: null,
                    }))
                );
                break;
            case "GOAL_START":
                setCurrentGoalIndex(event.index);
                setGoals((prev) => {
                    const newGoals = [...prev];
                    if (newGoals[event.index]) {
                        newGoals[event.index].status = "RUNNING";
                    }
                    return newGoals;
                });
                break;
            case "GOAL_PROGRESS":
                setGoals((prev) => {
                    const newGoals = [...prev];
                    const gIndex = newGoals.findIndex((g) => g.title === event.goal);
                    if (gIndex !== -1) {
                        newGoals[gIndex].logs.push(event.log);
                        setTimeout(() => scrollToBottom(gIndex), 50);
                    }
                    return newGoals;
                });
                break;
            case "GOAL_COMPLETE":
                setGoals((prev) => {
                    const newGoals = [...prev];
                    const gIndex = newGoals.findIndex((g) => g.title === event.goal);
                    if (gIndex !== -1) {
                        newGoals[gIndex].status = event.status;
                        newGoals[gIndex].reportId = event.reportId ?? null;
                    }
                    return newGoals;
                });
                break;
            case "SUMMARY_PROGRESS":
                setFinalSummary((prev) => prev + event.content);
                break;
            case "SUMMARY_GENERATED":
                setFinalSummary(event.summary);
                break;
            case "COMPLETE":
                if (event.result?._id) setMasterPlanId(event.result._id);
                break;
            case "ERROR":
                setError(event.message);
                break;
        }
    };

    const progressValue = goals.length > 0 
        ? (goals.filter(g => g.status === "SUCCESS" || g.status === "FAILED").length / goals.length) * 100 
        : 0;

    return (
        <div className="p-10 max-w-5xl mx-auto w-full h-full overflow-y-auto space-y-8 bg-gray-50/50">
            <div>
                <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-2">Master Planner</h1>
                <p className="text-gray-500 text-lg">
                    Orchestrate automated test generation and verify documentation across real-world scenarios.
                </p>
            </div>

            <Card className="border-none shadow-md overflow-hidden bg-white">
                <CardHeader className="bg-orange-50/50 border-b border-orange-100 pb-6">
                    <CardTitle className="flex items-center gap-2 text-orange-700">
                        <BrainCircuit className="w-5 h-5" />
                        Configuration
                    </CardTitle>
                    <CardDescription>Select a project corpus to analyze.</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="flex gap-4 items-end">
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Target Project Vector
                            </label>
                            <select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={loading}
                            >
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.projectName}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-none w-32 space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Max Goals
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={15}
                                value={maxGoals}
                                onChange={(e) => setMaxGoals(Number(e.target.value) || 1)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={loading}
                            />
                        </div>
                    </div>
                    <div className="flex gap-4 items-start mt-4">
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Initial Context (JSON)
                            </label>
                            <textarea
                                value={initialContext}
                                onChange={(e) => setInitialContext(e.target.value)}
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                                disabled={loading}
                                placeholder='{"api_key": "...", "url": "..."}'
                            />
                        </div>
                        <div className="flex-none pt-7">
                            <button
                                onClick={handleRunMasterPlan}
                                disabled={loading || !projectId}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-orange-600 text-primary-foreground hover:bg-orange-600/90 h-10 px-6 py-2 gap-2 shadow-sm"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {loading ? "Planning in progress..." : "Run Master Plan"}
                            </button>
                        </div>
                    </div>
                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100 flex items-center gap-2">
                            <XCircle className="w-4 h-4" /> {error}
                        </div>
                    )}
                </CardContent>
            </Card>

            {(goals.length > 0 || loading) && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2 text-gray-800">
                            <ListTodo className="w-6 h-6 text-orange-500" />
                            Execution Progress
                        </h2>
                        {goals.length > 0 && (
                            <Badge variant={isComplete ? "default" : "secondary"} className="px-3 py-1 text-sm font-medium">
                                {goals.filter(g => g.status === "SUCCESS" || g.status === "FAILED").length} / {goals.length} Goals
                            </Badge>
                        )}
                    </div>
                    
                    {goals.length > 0 && (
                        <Progress value={progressValue} className="h-2 w-full bg-orange-100 [&>div]:bg-orange-600" />
                    )}

                    <Accordion defaultValue={currentGoalIndex >= 0 ? [`item-${currentGoalIndex}`] : undefined as any} value={currentGoalIndex >= 0 ? [`item-${currentGoalIndex}`] : ([] as any)} onValueChange={() => {}} className="w-full space-y-4">
                        {goals.map((goal, idx) => (
                            <AccordionItem key={idx} value={`item-${idx}`} className="border bg-white rounded-lg shadow-sm overflow-hidden px-1">
                                <AccordionTrigger className="hover:no-underline px-4 py-4 group">
                                    <div className="flex items-center gap-4 w-full pr-4">
                                        <div className="flex-shrink-0">
                                            {goal.status === "WAITING" && <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                                            {goal.status === "RUNNING" && <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />}
                                            {goal.status === "SUCCESS" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                                            {goal.status === "FAILED" && <XCircle className="w-5 h-5 text-red-500" />}
                                        </div>
                                        <div className="flex-1 text-left">
                                            <span className="font-medium text-gray-900 line-clamp-1">{goal.title}</span>
                                        </div>
                                        <Badge variant="outline" className={
                                            goal.status === "SUCCESS" ? "border-emerald-200 text-emerald-700 bg-emerald-50" :
                                            goal.status === "FAILED" ? "border-red-200 text-red-700 bg-red-50" :
                                            goal.status === "RUNNING" ? "border-orange-200 text-orange-700 bg-orange-50" :
                                            "text-gray-500 border-gray-200"
                                        }>
                                            {goal.status}
                                        </Badge>
                                        {goal.reportId && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); window.open(`http://localhost:5173`, "_self"); }}
                                                className="text-xs text-orange-600 hover:text-orange-800 font-medium border border-orange-200 bg-orange-50 hover:bg-orange-100 px-2 py-0.5 rounded transition-colors"
                                                title={`Report: ${goal.reportId}`}
                                            >
                                                View Report →
                                            </button>
                                        )}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-4 pb-4">
                                    <div className="bg-gray-950 rounded-md p-4 mt-2 border border-gray-800 relative shadow-inner">
                                        <ScrollArea className="h-[250px] w-full rounded-md">
                                            <div className="space-y-3 font-mono text-[13px] leading-relaxed text-gray-300 pr-4">
                                                {goal.logs.length === 0 ? (
                                                    <span className="text-gray-600 italic">Waiting for agent to start...</span>
                                                ) : (
                                                    goal.logs.map((log, i) => (
                                                        <div key={i} className="whitespace-pre-wrap break-words">
                                                            <span className="text-gray-500 select-none mr-3">{String(i + 1).padStart(2, '0')}</span>
                                                            <span className={log.includes("SUCCESS") ? "text-emerald-400" : log.includes("ERROR") || log.includes("FAILED") ? "text-red-400" : ""}>
                                                                {log}
                                                            </span>
                                                        </div>
                                                    ))
                                                )}
                                                <div ref={(el) => { scrollRefs.current[idx] = el; }} />
                                            </div>
                                        </ScrollArea>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </div>
            )}

            {finalSummary && (
                <Card className="border-none shadow-lg bg-white overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4 flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-gray-800">
                            <FileText className="w-5 h-5 text-orange-500" />
                            Master Plan Complete
                        </CardTitle>
                        {masterPlanId && (
                            <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); alert(`Master Plan ID: ${masterPlanId}\nView it in the Reports tab → Master Plans`); }}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-800 border border-orange-200 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                View in Reports Tab
                            </a>
                        )}
                    </CardHeader>
                    <CardContent className="pt-6">
                        <p className="text-sm text-gray-500 mb-4 italic">Executive summary from the LLM — full structured report with taxonomy, gaps, and recommendations is in the Reports tab.</p>
                        <div 
                            className="prose prose-slate prose-orange max-w-none text-gray-700 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: marked.parse(finalSummary) as string }}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
