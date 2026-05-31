import { useEffect, useState, useRef } from "react";
import { CheckCircle2, XCircle, Loader2, Play, BrainCircuit, Activity } from "lucide-react";
import { marked } from "marked";

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
    const [maxGoals, setMaxGoals] = useState(5);
    const [initialContext, setInitialContext] = useState("{}");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [goals, setGoals] = useState<ExecutionGoal[]>([]);
    const [currentGoalIndex, setCurrentGoalIndex] = useState(-1);
    const [finalSummary, setFinalSummary] = useState("");
    const [masterPlanId, setMasterPlanId] = useState<string | null>(null);
    const [globalLogs, setGlobalLogs] = useState<string[]>([]);

    const scrollRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

    useEffect(() => {
        fetch("http://localhost:3000/projects")
            .then((r) => r.json())
            .then((data) => {
                setProjects(data.projects || []);
                if (data.projects?.length > 0) setProjectId(data.projects[0].id);
            });
    }, []);

    const scrollToBottom = (i: number) => {
        scrollRefs.current[i]?.scrollIntoView({ behavior: "smooth" });
    };

    const handleRun = async () => {
        setLoading(true);
        setError("");
        setGoals([]);
        setCurrentGoalIndex(-1);
        setFinalSummary("");
        setMasterPlanId(null);
        setGlobalLogs([]);

        try {
            const res = await fetch("http://localhost:3000/planner/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId, maxGoals, initialContext }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: res.statusText }));
                setError(err.message || "Failed");
                setLoading(false);
                return;
            }
            if (!res.body) { setError("No stream"); setLoading(false); return; }

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try { handleEvent(JSON.parse(line)); } catch {}
                }
            }
            if (buffer.trim()) {
                try { handleEvent(JSON.parse(buffer)); } catch {}
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const handleEvent = (event: any) => {
        switch (event.type) {
            case "GOALS_GENERATED":
                setGoals(event.goals.map((g: string) => ({ title: g, status: "WAITING", logs: [], reportId: null })));
                break;
            case "GOAL_START":
                setCurrentGoalIndex(event.index);
                setGoals((prev) => {
                    const n = [...prev];
                    if (n[event.index]) n[event.index].status = "RUNNING";
                    return n;
                });
                break;
            case "GOAL_PROGRESS":
                setGoals((prev) => {
                    const n = [...prev];
                    const i = n.findIndex((g) => g.title === event.goal);
                    if (i !== -1) {
                        n[i].logs.push(event.log);
                        setTimeout(() => scrollToBottom(i), 50);
                    }
                    return n;
                });
                break;
            case "GOAL_COMPLETE":
                setGoals((prev) => {
                    const n = [...prev];
                    const i = n.findIndex((g) => g.title === event.goal);
                    if (i !== -1) {
                        n[i].status = event.status;
                        n[i].reportId = event.reportId ?? null;
                    }
                    return n;
                });
                break;
            case "SUMMARY_PROGRESS":
                setFinalSummary((p) => p + event.content);
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
            case "log":
                setGlobalLogs((prev) => [...prev, event.content]);
                break;
            case "INIT":
                setGlobalLogs((prev) => [...prev, "Initializing Master Planner protocol..."]);
                break;
        }
    };

    const done = goals.filter((g) => g.status === "SUCCESS" || g.status === "FAILED").length;
    const progress = goals.length > 0 ? (done / goals.length) * 100 : 0;

    return (
        <div className="flex-1 overflow-y-auto animate-enter">
            <div className="max-w-5xl mx-auto px-8 py-10 space-y-10">
                <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-gradient-to-br from-gray-500 to-gray-600 rounded-2xl shadow-lg shadow-gray-500/20">
                        <BrainCircuit size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Master Planner</h1>
                        <p className="text-gray-400 text-sm">Orchestrate automated test generation across a documentation corpus.</p>
                    </div>
                </div>

                <div className="glass-panel rounded-3xl p-8 space-y-6 shadow-2xl relative overflow-hidden">
                    <div className="flex gap-6 items-end relative z-10">
                        <div className="flex-1">
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Target Project</label>
                            <select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                disabled={loading}
                                className="w-full px-4 py-3 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white appearance-none focus:border-gray-500/50 outline-none transition-all"
                            >
                                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                            </select>
                        </div>
                        <div className="w-32">
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Max Goals</label>
                            <input
                                type="number"
                                min={1}
                                max={15}
                                value={maxGoals}
                                onChange={(e) => setMaxGoals(Number(e.target.value) || 1)}
                                disabled={loading}
                                className="w-full px-4 py-3 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white font-mono focus:border-gray-500/50 outline-none transition-all"
                            />
                        </div>
                    </div>
                    <div className="relative z-10">
                        <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Base Context</label>
                        <textarea
                            value={initialContext}
                            onChange={(e) => setInitialContext(e.target.value)}
                            disabled={loading}
                            className="w-full px-4 py-3 bg-[#151517]/60 border border-white/10 rounded-xl text-sm text-green-400 font-mono h-20 focus:border-gray-500/50 outline-none transition-all"
                            placeholder='{"api_key": "..."}'
                        />
                    </div>
                    <div className="flex items-center gap-4 pt-2 relative z-10">
                        <button
                            onClick={handleRun}
                            disabled={loading || !projectId}
                            className="px-6 py-3 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-all flex items-center gap-2 shadow-lg shadow-white/5 active:scale-95"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} className="fill-black" />}
                            {loading ? "Planning..." : "Execute Master Plan"}
                        </button>
                        {error && <span className="text-rose-400 text-sm font-mono bg-rose-500/10 px-3 py-1 rounded border border-rose-500/20">{error}</span>}
                    </div>
                </div>

                {loading && goals.length === 0 && globalLogs.length > 0 && (
                    <div className="glass-panel rounded-3xl p-6 shadow-2xl animate-enter">
                        <div className="flex items-center gap-3 mb-4 border-b border-white/5 pb-4">
                            <Loader2 size={18} className="animate-spin text-gray-400" />
                            <h3 className="text-[12px] uppercase tracking-widest text-gray-400 font-semibold">
                                Initialization Sequence
                            </h3>
                        </div>
                        <div className="font-mono text-xs leading-relaxed space-y-2 text-gray-400">
                            {globalLogs.map((log, i) => (
                                <div key={i} className="flex gap-3">
                                    <span className="text-gray-700 select-none shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                    <span className={log.includes("completed") ? "text-emerald-400" : ""}>{log}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {goals.length > 0 && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[12px] uppercase tracking-widest text-gray-400 font-semibold flex items-center gap-2">
                                <Activity size={14} className="text-gray-500" />
                                Execution Progress
                            </h3>
                            <span className="text-[11px] font-mono font-bold text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">{done} / {goals.length}</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                            <div
                                className="h-full bg-gradient-to-r from-gray-500 to-yellow-400 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <div className="space-y-3">
                            {goals.map((goal, idx) => (
                                <details
                                    key={idx}
                                    open={idx === currentGoalIndex}
                                    className="glass-panel rounded-2xl overflow-hidden group"
                                >
                                    <summary className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-white/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                                        <div className="shrink-0">
                                            {goal.status === "WAITING" && <div className="w-5 h-5 rounded-full border-2 border-white/20" />}
                                            {goal.status === "RUNNING" && <Loader2 size={20} className="text-gray-400 animate-spin" />}
                                            {goal.status === "SUCCESS" && <CheckCircle2 size={20} className="text-emerald-400" />}
                                            {goal.status === "FAILED" && <XCircle size={20} className="text-rose-400" />}
                                        </div>
                                        <span className="text-sm font-medium flex-1 truncate text-gray-200 group-hover:text-white transition-colors">{goal.title}</span>
                                        <span className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-lg border shadow-inner ${
                                            goal.status === "SUCCESS" ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/10 shadow-emerald-500/10" :
                                            goal.status === "FAILED" ? "border-rose-500/20 text-rose-400 bg-rose-500/10 shadow-rose-500/10" :
                                            goal.status === "RUNNING" ? "border-gray-500/30 text-gray-400 bg-gray-500/10 shadow-gray-500/10" :
                                            "border-white/10 text-gray-500 bg-white/5"
                                        }`}>
                                            {goal.status}
                                        </span>
                                    </summary>
                                    <div className="border-t border-white/5 bg-[#151517]/60 p-5 max-h-[250px] overflow-y-auto">
                                        <div className="font-mono text-xs leading-relaxed space-y-1">
                                            {goal.logs.length === 0 ? (
                                                <span className="text-gray-600 italic">Waiting for execution...</span>
                                            ) : (
                                                goal.logs.map((log, i) => (
                                                    <div key={i} className={`flex gap-3 ${
                                                        log.includes("SUCCESS") ? "text-emerald-400" :
                                                        log.includes("ERROR") || log.includes("FAILED") ? "text-rose-400" :
                                                        "text-gray-400"
                                                    }`}>
                                                        <span className="text-gray-700 select-none shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                                        <span>{log}</span>
                                                    </div>
                                                ))
                                            )}
                                            <div ref={(el) => { scrollRefs.current[idx] = el; }} />
                                        </div>
                                    </div>
                                </details>
                            ))}
                        </div>
                    </div>
                )}

                {finalSummary && (
                    <div className="glass-panel rounded-3xl overflow-hidden animate-enter shadow-2xl">
                        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                            <span className="text-[12px] uppercase tracking-widest text-gray-400 font-bold">Executive Summary</span>
                            {masterPlanId && (
                                <span className="text-[10px] font-mono text-gray-500 bg-[#1c1c1e] px-2 py-1 rounded border border-white/5">{masterPlanId}</span>
                            )}
                        </div>
                        <div className="p-8 bg-[#151517]/20">
                            <div
                                className="prose-dark text-sm"
                                dangerouslySetInnerHTML={{ __html: marked.parse(finalSummary) as string }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
