import { useMemo, useState } from "react";
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    Check,
    CheckCircle,
    ChevronDown,
    ChevronUp,
    Copy,
    FileCode,
    FileText,
    Loader,
    X,
    XCircle,
} from "lucide-react";
import { marked } from "marked";

const MarkdownRenderer = ({ content }: { content: string }) => {
    const html = useMemo(() => {
        try {
            return marked.parse(content);
        } catch {
            return content;
        }
    }, [content]);

    return (
        <div
            className="prose prose-invert max-w-full prose-headings:bg-gradient-to-r prose-headings:from-gray-200 prose-headings:to-gray-500 prose-headings:bg-clip-text prose-headings:text-transparent prose-a:text-white hover:prose-a:text-gray-300 transition-all duration-300"
            dangerouslySetInnerHTML={{ __html: html as string }}
        />
    );
};

const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, any> = {
        SUCCESS: {
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/20",
            text: "text-emerald-400",
            shadow: "shadow-[0_0_10px_rgba(16,185,129,0.1)]",
            icon: <CheckCircle size={14} className="mr-1.5" />,
        },
        FAILED: {
            bg: "bg-rose-500/10",
            border: "border-rose-500/20",
            text: "text-rose-400",
            shadow: "shadow-[0_0_10px_rgba(244,63,94,0.1)]",
            icon: <XCircle size={14} className="mr-1.5" />,
        },
        PARTIAL_FAILURE: {
            bg: "bg-amber-500/10",
            border: "border-amber-500/20",
            text: "text-amber-400",
            shadow: "shadow-[0_0_10px_rgba(245,158,11,0.1)]",
            icon: <AlertTriangle size={14} className="mr-1.5" />,
        },
        RUNNING: {
            bg: "bg-white/5",
            border: "border-white/10",
            text: "text-gray-300",
            shadow: "shadow-[0_0_10px_rgba(255,255,255,0.05)]",
            icon: <Loader size={14} className="mr-1.5 animate-spin" />,
        },
    };
    const current = config[status] || config.RUNNING;

    return (
        <span
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 ${current.bg} ${current.border} ${current.text} ${current.shadow}`}
        >
            {current.icon}
            {status}
        </span>
    );
};

const CodeBlock = ({ code, language = "javascript" }: { code: string; language?: string }) => (
    <div className="bg-[#151517]/40 backdrop-blur-xl rounded-xl overflow-hidden border border-white/10 transition-all duration-300 hover:shadow-2xl hover:shadow-white/5 hover:border-white/20 group">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/10 bg-white/5 group-hover:bg-white/10 transition-colors duration-300">
            <span className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
                {language}
            </span>
            <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="text-gray-500 hover:text-white active:scale-95 transition-all duration-300 p-1 rounded-md hover:bg-white/10"
                title="Copy"
            >
                <Copy size={14} />
            </button>
        </div>
        <pre className="p-5 text-xs text-gray-300 font-mono overflow-x-auto max-h-96">
      <code>{code}</code>
        </pre>
    </div>
);

const RelatedKnowledgeItem = ({ item }: { item: any }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const payload = item.payload || item;
    const content = payload.content;
    const metadata = payload.metadata || {};
    const score = item.score;

    if (!content) {
        return (
            <div className="bg-white/5 border border-amber-500/20 backdrop-blur-xl rounded-xl p-4 transition-all duration-300 hover:shadow-xl">
                <pre className="text-xs text-amber-400 whitespace-pre-wrap font-mono overflow-x-auto">
          {JSON.stringify(item, null, 2)}
                </pre>
            </div>
        );
    }

    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden mb-3 transition-all duration-300 hover:shadow-2xl hover:shadow-white/5 hover:-translate-y-0.5">
            <div
                className="px-5 py-4 border-b border-transparent flex justify-between items-center cursor-pointer hover:bg-white/5 transition-colors duration-300"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <FileText size={16} className={`transition-colors duration-300 ${isExpanded ? "text-gray-400/80" : "text-gray-500"}`} />
                    <span className="text-sm font-medium text-gray-200">
                        {metadata.fileName || "Knowledge Base Match"}
                    </span>
                    {metadata.lineNumber && (
                        <span className="text-[10px] text-gray-500 font-mono bg-[#151517]/40 px-2 py-0.5 rounded-full border border-white/10">
                            Line: {metadata.lineNumber}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-gray-400 font-mono bg-[#151517]/40 px-2.5 py-1 rounded-full border border-white/10 shadow-inner">
                        Score: {typeof score === "number" ? score.toFixed(4) : "N/A"}
                    </span>
                    <div className="text-gray-500 bg-white/5 p-1 rounded-full border border-white/5">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="p-5 border-t border-white/10 bg-[#151517]/20 backdrop-blur-md">
                    <MarkdownRenderer content={content} />
                </div>
            )}
        </div>
    );
};

const StepDetail = ({ step }: { step: any }) => {
    const [isOpen, setIsOpen] = useState(step.status === "FAILED");
    const [activeTab, setActiveTab] = useState("logs");

    const relatedItems = useMemo(() => {
        if (!step.relatedKnowledge) return [];
        if (Array.isArray(step.relatedKnowledge)) return step.relatedKnowledge;
        if (step.relatedKnowledge.points && Array.isArray(step.relatedKnowledge.points)) {
            return step.relatedKnowledge.points;
        }
        return [];
    }, [step.relatedKnowledge]);

    const hasRelated = relatedItems.length > 0;
    const hasAnalysis = !!step.failureAnalysis;
    const isFailed = step.status === "FAILED";

    return (
        <div
            className={`rounded-xl mb-4 bg-white/5 backdrop-blur-xl overflow-hidden border transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 ${
                isFailed ? "border-rose-500/30 hover:shadow-[0_0_15px_rgba(244,63,94,0.1)]" : "border-white/10 hover:shadow-white/5"
            }`}
        >
            <div
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors duration-300"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-4">
                    <div
                        className={`p-2.5 rounded-xl border backdrop-blur-md shadow-inner transition-transform duration-300 ${
                            isFailed
                                ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        }`}
                    >
                        {isFailed
                            ? <X size={18} className="stroke-[3px]" />
                            : <Check size={18} className="stroke-[3px]" />}
                    </div>
                    <div>
                        <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-gray-100 to-gray-400 text-sm tracking-wide">
                            Step {step.stepIndex}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1 font-sans">{step.stepDescription}</p>
                    </div>
                </div>
                <div className="text-gray-500 bg-white/5 p-1.5 rounded-full border border-white/5 transition-transform duration-300">
                    {isOpen
                        ? <ChevronUp size={16} />
                        : <ChevronDown size={16} />}
                </div>
            </div>

            {isOpen && (
                <div className="border-t border-white/10 bg-[#151517]/20">
                    <div className="flex border-b border-white/10 px-5 gap-2 overflow-x-auto no-scrollbar">
                        {["logs", "analysis", "script", "context", "related"].map((tab) => {
                            if (tab === "related" && !hasRelated) return null;
                            if (tab === "analysis" && !hasAnalysis) return null;
                            return (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-3 text-[11px] font-mono uppercase tracking-widest transition-all duration-300 border-b-2 active:scale-95 whitespace-nowrap ${
                                        activeTab === tab
                                            ? "border-gray-200 text-gray-200"
                                            : "border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600/50"
                                    }`}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-6">
                        {activeTab === "logs" && (
                            <div className="space-y-5">
                                {step.error && (
                                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 backdrop-blur-md shadow-[0_0_15px_rgba(244,63,94,0.05)]">
                                        <pre className="text-rose-400/90 text-xs font-mono whitespace-pre-wrap">{step.error}</pre>
                                    </div>
                                )}
                                <CodeBlock
                                    code={step.logs || "No logs captured."}
                                    language="bash"
                                />
                            </div>
                        )}
                        {activeTab === "analysis" && step.failureAnalysis && (
                            <div className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 transition-all duration-300 hover:bg-white/10">
                                        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-1.5">
                                            Documentation Gap
                                        </p>
                                        <p
                                            className={`text-sm font-mono font-semibold ${
                                                step.failureAnalysis.documentationGap === "MISSING"
                                                    ? "text-rose-400"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "AMBIGUOUS"
                                                    ? "text-amber-400"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "INCORRECT"
                                                    ? "text-red-400"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "CONFIG"
                                                    ? "text-blue-400"
                                                    : "text-gray-300"
                                            }`}
                                        >
                                            {step.failureAnalysis.documentationGap}
                                        </p>
                                    </div>
                                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 transition-all duration-300 hover:bg-white/10">
                                        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-1.5">
                                            Failed Function
                                        </p>
                                        <p className="text-sm font-mono font-semibold text-gray-200">
                                            {step.failureAnalysis.failedFunction}
                                        </p>
                                    </div>
                                </div>
                                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 transition-all duration-300 hover:bg-white/10">
                                    <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-3">
                                        Reasoning
                                    </p>
                                    <p className="text-sm text-gray-300 leading-relaxed font-sans">
                                        {step.failureAnalysis.reasoning}
                                    </p>
                                </div>
                                {step.failureAnalysis.pinpointedFragment && (
                                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 backdrop-blur-md">
                                        <p className="text-[10px] text-rose-400/90 font-mono uppercase tracking-widest mb-3 font-semibold">
                                            Pinpointed Documentation Fragment (Problematic)
                                        </p>
                                        <div className="bg-[#151517]/40 border border-white/5 rounded-lg p-4 shadow-inner">
                                            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap italic">
                                                "{step.failureAnalysis.pinpointedFragment}"
                                            </pre>
                                        </div>
                                    </div>
                                )}
                                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 transition-all duration-300 hover:bg-white/10">
                                    <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-3">
                                        Suggested Documentation Fix
                                    </p>
                                    <p className="text-sm text-gray-300 leading-relaxed mb-5 font-sans">
                                        {step.failureAnalysis.suggestedDocsFix}
                                    </p>
                                    {step.failureAnalysis.proposedFragment && (
                                        <div className="mt-5 border-t border-white/10 pt-5">
                                            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-3 font-semibold">
                                                Proposed Documentation Update
                                            </p>
                                            <div className="bg-[#151517]/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-inner">
                                                <div className="bg-emerald-500/10 px-4 py-2 border-b border-emerald-500/20 flex items-center gap-2">
                                                    <CheckCircle size={14} className="text-emerald-400" />
                                                    <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-widest">Corrected version</span>
                                                </div>
                                                <div className="p-5">
                                                    <MarkdownRenderer content={step.failureAnalysis.proposedFragment} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 transition-all duration-300 hover:bg-white/10">
                                    <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-3">
                                        Full Error Message
                                    </p>
                                    <pre className="text-xs text-rose-400/90 font-mono whitespace-pre-wrap bg-[#151517]/40 p-4 rounded-lg shadow-inner">{step.failureAnalysis.errorMessage}</pre>
                                </div>
                            </div>
                        )}
                        {activeTab === "script" && <CodeBlock code={step.scriptContent} />}
                        {activeTab === "context" && (
                            <div className="bg-[#151517]/40 backdrop-blur-xl rounded-xl border border-white/10 p-5 shadow-inner">
                                <pre className="text-xs text-gray-300 font-mono overflow-auto max-h-96">
                  {JSON.stringify(step.contextAfter, null, 2)}
                                </pre>
                            </div>
                        )}
                        {activeTab === "related" && (
                            <div className="space-y-4">
                                {relatedItems.map((item: any, idx: number) => (
                                    <RelatedKnowledgeItem key={idx} item={item} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default function ReportViewer({ report, onBack }: { report: any; onBack: () => void }) {
    const steps = report.detailedResults?.steps || report.steps || [];
    const isCodeGeneration = report.type === "CODE_GENERATION";

    return (
        <div className="flex flex-col h-full bg-[#1c1c1e] text-gray-200 overflow-y-auto selection:bg-gray-500/30 font-sans">
            <div className="bg-[#151517]/60 backdrop-blur-2xl border-b border-white/10 sticky top-0 z-20 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
                <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <button
                            onClick={onBack}
                            className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-300 hover:shadow-lg hover:shadow-white/5"
                            title="Back to Stream"
                        >
                            <ArrowLeft size={16} />
                        </button>
                        <div>
                            <h1 className="text-sm font-semibold flex items-center gap-2.5 bg-gradient-to-r from-gray-100 to-gray-400 bg-clip-text text-transparent tracking-wide">
                                <Activity className="text-gray-400" size={16} />
                                {isCodeGeneration
                                    ? "Code Generation Report"
                                    : "Test Execution Report"}
                            </h1>
                            <p className="text-[10px] text-gray-500 mt-1.5 font-mono uppercase tracking-widest flex items-center gap-2">
                                <span>Suite: <span className="text-gray-300 font-semibold">{report.testSuiteId}</span></span>
                                <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                                <span>{new Date(report.createdAt).toLocaleString()}</span>
                            </p>
                        </div>
                    </div>
                    <StatusBadge status={report.status} />
                </div>
            </div>

            <div className="max-w-6xl mx-auto w-full px-6 py-10 space-y-10 relative">
                {/* Decorative background blurs */}
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-[128px] -z-10 pointer-events-none" />
                <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-[128px] -z-10 pointer-events-none" />

                {isCodeGeneration && report.detailedResults?.finalOutput && (
                    <div className="bg-white/5 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-2xl transition-all duration-300 hover:border-white/20">
                        <h2 className="text-sm font-semibold bg-gradient-to-r from-gray-200 to-gray-500 bg-clip-text text-transparent mb-6 flex items-center gap-3 border-b border-white/10 pb-4">
                            <div className="p-1.5 bg-white/5 rounded-lg border border-white/5">
                                <FileCode className="text-gray-400" size={16} />
                            </div>
                            Generated Deliverables
                        </h2>
                        <div className="bg-[#151517]/20 p-6 rounded-xl border border-white/5 shadow-inner">
                            <MarkdownRenderer content={report.detailedResults.finalOutput} />
                        </div>
                    </div>
                )}

                <div>
                    <h2 className="text-[11px] font-mono uppercase tracking-widest text-gray-400 mb-6 flex items-center gap-3 border-b border-white/10 pb-4 ml-1">
                        <Activity className="text-gray-500" size={14} />
                        Execution Diagnostics & Validation
                    </h2>
                    <div className="space-y-4">
                        {steps.length === 0 && (
                            <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center backdrop-blur-xl">
                                <p className="text-gray-500 text-sm font-mono tracking-wide">
                                    No execution steps found in this report.
                                </p>
                            </div>
                        )}
                        {steps.map((step: any) => <StepDetail key={step.stepIndex} step={step} />)}
                    </div>
                </div>
            </div>
        </div>
    );
}
