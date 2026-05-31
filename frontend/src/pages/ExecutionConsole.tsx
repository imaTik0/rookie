import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Square, Play, Terminal } from "lucide-react";
import ReportViewer from "../components/ReportViewer";

interface LogEvent {
    type: "log" | "token";
    content: string;
}

export default function ExecutionConsole() {
    const { id } = useParams();
    const [suiteId, setSuiteId] = useState(id || "");
    const [logs, setLogs] = useState<LogEvent[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [report, setReport] = useState<any>(null);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => { if (id) setSuiteId(id); }, [id]);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    const handleExecute = () => {
        if (!suiteId.trim()) return;
        setLogs([]);
        setReport(null);
        setIsRunning(true);

        const es = new EventSource(`http://localhost:3000/testsuites/${suiteId}/execute/stream`);

        es.onmessage = (event) => {
            try {
                if (!event.data?.trim()) return;
                const parsed = JSON.parse(event.data);
                setLogs((prev) => {
                    const last = prev[prev.length - 1];
                    if (parsed.type === "token" && last?.type === "token") {
                        const copy = [...prev];
                        copy[copy.length - 1] = { ...last, content: last.content + parsed.content };
                        return copy;
                    }
                    return [...prev, parsed];
                });
            } catch {
                setLogs((prev) => [...prev, { type: "log", content: event.data }]);
            }
        };

        es.addEventListener("done", (event: any) => {
            if (event.data) {
                try { setReport(JSON.parse(event.data)); } catch {}
            }
            setLogs((prev) => [...prev, { type: "log", content: "\n✓ Complete\n" }]);
            es.close();
            setIsRunning(false);
        });

        es.addEventListener("error", (event: any) => {
            if (event.data) {
                setLogs((prev) => [...prev, { type: "log", content: `\n✗ Error: ${event.data}\n` }]);
            }
            es.close();
            setIsRunning(false);
        });
    };

    if (report) {
        return <ReportViewer report={report} onBack={() => { setReport(null); setLogs([]); }} />;
    }

    return (
        <div className="flex-1 flex flex-col h-full animate-enter bg-[#1c1c1e]">
            {/* Toolbar */}
            <div className="h-16 border-b border-white/10 bg-[#202022] flex items-center px-6 gap-4 shrink-0 shadow-lg relative z-20">
                <div className="flex items-center gap-2 text-gray-500 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                    <Terminal size={14} />
                </div>
                <input
                    type="text"
                    value={suiteId}
                    onChange={(e) => setSuiteId(e.target.value)}
                    placeholder="Test Suite ID..."
                    disabled={isRunning}
                    className="bg-[#151517]/50 border border-white/10 text-sm px-4 py-2 rounded-xl w-80 text-white placeholder:text-gray-600 font-mono focus:border-gray-500/50 focus:bg-[#1c1c1e] outline-none transition-all disabled:opacity-50"
                />
                <button
                    onClick={handleExecute}
                    disabled={isRunning || !suiteId}
                    className="flex items-center gap-2 px-5 py-2 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-all shadow-lg shadow-white/5 active:scale-95"
                >
                    <Play size={12} className="fill-black" />
                    {isRunning ? "Executing Protocol..." : "Run Protocol"}
                </button>
                <div className="flex-1" />
                <button
                    onClick={() => navigator.clipboard.writeText(logs.map((l) => l.content).join(""))}
                    className="p-2.5 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 transition-all active:scale-95"
                    title="Copy Output"
                >
                    <Copy size={16} />
                </button>
            </div>

            {/* Console */}
            <div className="flex-1 overflow-y-auto relative">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gray-500/[0.03] via-black to-black pointer-events-none" />
                
                <div className="p-8 font-mono text-[13px] leading-loose relative z-10">
                    {logs.length === 0 && (
                        <div className="h-full min-h-[400px] flex items-center justify-center">
                            <div className="text-center">
                                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-2xl">
                                    <Square size={24} className="text-gray-600" />
                                </div>
                                <p className="text-[11px] tracking-widest uppercase text-gray-500 font-semibold">Awaiting Execution Sequence</p>
                            </div>
                        </div>
                    )}

                    <div className="space-y-1">
                        {logs.map((log, i) => (
                            <div key={i}>
                                <span
                                    className={
                                        log.type === "token"
                                            ? "text-gray-300"
                                            : log.content.includes("✗") || log.content.includes("ERROR") || log.content.includes("FAILED")
                                                ? "text-rose-400"
                                                : log.content.includes("✓") || log.content.includes("SUCCESS")
                                                    ? "text-emerald-400"
                                                    : "text-blue-400"
                                    }
                                >
                                    {log.content}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div ref={endRef} className="h-10" />
                </div>
            </div>
        </div>
    );
}
