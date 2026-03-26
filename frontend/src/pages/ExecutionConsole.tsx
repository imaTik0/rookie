import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Play, Terminal } from "lucide-react";
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
    const endOfLogsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (id) {
            setSuiteId(id);
        }
    }, [id]);

    useEffect(() => {
        endOfLogsRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleExecute = () => {
        if (!suiteId.trim()) return;
        setLogs([]);
        setReport(null);
        setIsRunning(true);

        const eventSource = new EventSource(
            `http://localhost:3000/testsuites/${suiteId}/execute/stream`,
        );

        eventSource.onmessage = (event) => {
            try {
                if (!event.data || event.data.trim() === "") return;
                const parsed = JSON.parse(event.data);

                setLogs((prev) => {
                    const newLogs = [...prev];
                    const lastIndex = newLogs.length - 1;
                    const lastLog = newLogs[lastIndex];

                    if (parsed.type === "token" && lastLog && lastLog.type === "token") {
                        // Fix React StrictMode bug: never mutate state objects! Create a fresh object for the updated token stream
                        newLogs[lastIndex] = {
                            ...lastLog,
                            content: lastLog.content + parsed.content,
                        };
                        return newLogs;
                    }

                    return [...newLogs, parsed];
                });
            } catch (err) {
                setLogs((prev) => [...prev, { type: "log", content: event.data }]);
            }
        };

        eventSource.addEventListener("done", (event: any) => {
            if (event.data) {
                try {
                    const parsedReport = JSON.parse(event.data);
                    setReport(parsedReport);
                } catch (e) {}
            }
            setLogs(
                (prev) => [...prev, { type: "log", content: "\n--- AGENTIC RAG COMPLETED ---\n" }],
            );
            eventSource.close();
            setIsRunning(false);
        });

        eventSource.addEventListener("error", (event: any) => {
            if (event.data) {
                setLogs(
                    (prev) => [...prev, { type: "log", content: `[ERROR FATAL]: ${event.data}` }],
                );
            }
            eventSource.close();
            setIsRunning(false);
        });
    };

    const handleCopyLogs = () => {
        const text = logs.map((l) => l.content).join("");
        navigator.clipboard.writeText(text);
    };

    if (report) {
        return (
            <ReportViewer
                report={report}
                onBack={() => {
                    setReport(null);
                    setLogs([]);
                }}
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-white relative">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <Terminal className="text-orange-500" />
                    <h2 className="text-xl font-bold text-gray-900 tracking-widest uppercase text-sm">
                        Execution Stream
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={suiteId}
                        onChange={(e) => setSuiteId(e.target.value)}
                        placeholder="TestSuite ID"
                        className="bg-white border border-gray-300 text-sm px-3 py-1.5 rounded-lg w-64 text-gray-900 focus:outline-none"
                        disabled={isRunning}
                    />
                    <button
                        onClick={handleExecute}
                        disabled={isRunning || !suiteId}
                        className="flex items-center gap-2 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                        <Play size={14} /> {isRunning ? "Streaming..." : "Run Diagnostics"}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden relative bg-gray-50">
                <div className="absolute top-4 right-4 z-10">
                    <button
                        onClick={handleCopyLogs}
                        className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md border border-gray-300 shadow-md"
                    >
                        <Copy size={16} />
                    </button>
                </div>

                <div className="h-full overflow-y-auto p-6 font-mono text-[13px] leading-relaxed">
                    {logs.length === 0 && (
                        <div className="h-full flex items-center justify-center text-gray-400 opacity-50 flex-col gap-4">
                            <Terminal size={48} />
                            <p>Standby... waiting for RAG invocation.</p>
                        </div>
                    )}

                    {logs.map((log, i) => (
                        <div key={i} className="mb-1 flex">
                            {log.type === "log" && (
                                <span className="text-orange-500 mr-3 select-none flex-shrink-0">
                                    ➜
                                </span>
                            )}
                            <span
                                className={`break-all whitespace-pre-wrap ${
                                    log.type === "token" ? "text-orange-600" : "text-gray-700"
                                }`}
                            >
                                {log.content}
                            </span>
                        </div>
                    ))}
                    <div ref={endOfLogsRef} className="h-8" />
                </div>
            </div>
        </div>
    );
}
