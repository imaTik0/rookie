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
            className="prose prose-sm max-w-full text-gray-700 prose-headings:text-gray-900 prose-a:text-orange-500 prose-code:text-orange-600 prose-code:bg-gray-100 prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200"
            dangerouslySetInnerHTML={{ __html: html as string }}
        />
    );
};

const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, any> = {
        SUCCESS: {
            bg: "bg-emerald-500/20",
            border: "border-emerald-500/30",
            text: "text-emerald-400",
            icon: <CheckCircle size={14} className="mr-1.5" />,
        },
        FAILED: {
            bg: "bg-rose-500/20",
            border: "border-rose-500/30",
            text: "text-rose-400",
            icon: <XCircle size={14} className="mr-1.5" />,
        },
        PARTIAL_FAILURE: {
            bg: "bg-amber-500/20",
            border: "border-amber-500/30",
            text: "text-amber-400",
            icon: <AlertTriangle size={14} className="mr-1.5" />,
        },
        RUNNING: {
            bg: "bg-blue-500/20",
            border: "border-blue-500/30",
            text: "text-orange-500",
            icon: <Loader size={14} className="mr-1.5 animate-spin" />,
        },
    };
    const current = config[status] || config.RUNNING;

    return (
        <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${current.bg} ${current.border} ${current.text}`}
        >
            {current.icon}
            {status}
        </span>
    );
};

const CodeBlock = ({ code, language = "javascript" }: { code: string; language?: string }) => (
    <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200 shadow-inner">
        <div className="bg-white px-4 py-2.5 flex items-center justify-between border-b border-gray-200">
            <span className="text-xs text-gray-600 font-medium uppercase tracking-wider">
                {language}
            </span>
            <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="text-gray-500 hover:text-orange-500 transition-colors"
                title="Copy"
            >
                <Copy size={14} />
            </button>
        </div>
        <pre className="p-4 text-xs text-emerald-400 font-mono overflow-x-auto max-h-96">
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
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <pre className="text-xs text-amber-600 whitespace-pre-wrap font-mono overflow-x-auto">
          {JSON.stringify(item, null, 2)}
                </pre>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-4 transition-all">
            <div
                className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <FileText size={16} className={`${isExpanded ? "text-orange-500" : "text-gray-400"}`} />
                    <span className="text-sm font-semibold text-gray-800">
                        {metadata.fileName || "Knowledge Base Match"}
                    </span>
                    {metadata.lineNumber && (
                        <span className="text-[10px] text-gray-400 font-mono">
                            Line: {metadata.lineNumber}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-gray-400 font-mono bg-white px-2 py-0.5 rounded border border-gray-200">
                        Score: {typeof score === "number" ? score.toFixed(4) : "N/A"}
                    </span>
                    {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </div>
            </div>
            {isExpanded && (
                <div className="p-5 bg-white border-t border-gray-100 animate-in fade-in slide-in-from-top-1 duration-200">
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
            className={`rounded-xl mb-4 bg-white shadow-lg overflow-hidden border ${
                isFailed ? "border-rose-500/30 shadow-rose-900/10" : "border-gray-200"
            }`}
        >
            <div
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-gray-100/50 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-4">
                    <div
                        className={`p-2.5 rounded-xl ${
                            isFailed
                                ? "bg-rose-500/20 text-rose-400 shadow-inner shadow-rose-500/20"
                                : "bg-emerald-500/20 text-emerald-400 shadow-inner shadow-emerald-500/20"
                        }`}
                    >
                        {isFailed
                            ? <X size={20} className="stroke-[3px]" />
                            : <Check size={20} className="stroke-[3px]" />}
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 text-base">Step {step.stepIndex}</h3>
                        <p className="text-sm text-gray-600 mt-0.5">{step.stepDescription}</p>
                    </div>
                </div>
                {isOpen
                    ? <ChevronUp className="text-gray-500" />
                    : <ChevronDown className="text-gray-500" />}
            </div>

            {isOpen && (
                <div className="border-t border-gray-200 bg-gray-50">
                    <div className="flex border-b border-gray-200 px-2 pt-2">
                        {["logs", "analysis", "script", "context", "related"].map((tab) => {
                            if (tab === "related" && !hasRelated) return null;
                            if (tab === "analysis" && !hasAnalysis) return null;
                            return (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-5 py-2.5 text-sm font-medium transition-all rounded-t-lg mx-1 ${
                                        activeTab === tab
                                            ? "bg-gray-100 text-gray-900 shadow-sm"
                                            : "text-gray-500 hover:text-gray-700 hover:bg-white"
                                    }`}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-6">
                        {activeTab === "logs" && (
                            <div className="space-y-4">
                                {step.error && (
                                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-inner">
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
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                            Documentation Gap
                                        </p>
                                        <p
                                            className={`text-lg font-bold ${
                                                step.failureAnalysis.documentationGap === "MISSING"
                                                    ? "text-rose-600"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "AMBIGUOUS"
                                                    ? "text-amber-600"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "INCORRECT"
                                                    ? "text-red-600"
                                                    : step.failureAnalysis.documentationGap ===
                                                            "CONFIG"
                                                    ? "text-blue-600"
                                                    : "text-gray-600"
                                            }`}
                                        >
                                            {step.failureAnalysis.documentationGap}
                                        </p>
                                    </div>
                                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                            Failed Function
                                        </p>
                                        <p className="text-sm font-mono font-semibold text-gray-900">
                                            {step.failureAnalysis.failedFunction}
                                        </p>
                                    </div>
                                </div>
                                <div className="bg-white border border-gray-200 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                                        Reasoning
                                    </p>
                                    <p className="text-sm text-gray-700 leading-relaxed">
                                        {step.failureAnalysis.reasoning}
                                    </p>
                                </div>
                                {step.failureAnalysis.pinpointedFragment && (
                                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                                        <p className="text-xs text-rose-600 uppercase tracking-wider mb-2 font-bold">
                                            Pinpointed Documentation Fragment (Problematic)
                                        </p>
                                        <div className="bg-white border border-rose-100 rounded-lg p-3 shadow-inner">
                                            <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap italic">
                                                "{step.failureAnalysis.pinpointedFragment}"
                                            </pre>
                                        </div>
                                    </div>
                                )}
                                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                                    <p className="text-xs text-orange-600 uppercase tracking-wider mb-2">
                                        Suggested Documentation Fix
                                    </p>
                                    <p className="text-sm text-gray-800 leading-relaxed mb-4">
                                        {step.failureAnalysis.suggestedDocsFix}
                                    </p>
                                    {step.failureAnalysis.proposedFragment && (
                                        <div className="mt-4">
                                            <p className="text-[10px] text-orange-500 uppercase tracking-widest mb-2 font-bold">
                                                Proposed Documentation Update
                                            </p>
                                            <div className="bg-white border border-orange-100 rounded-lg overflow-hidden shadow-sm">
                                                <div className="bg-emerald-50 px-3 py-1.5 border-b border-emerald-100 flex items-center gap-2">
                                                    <CheckCircle size={12} className="text-emerald-500" />
                                                    <span className="text-[10px] text-emerald-600 font-bold uppercase">Corrected version</span>
                                                </div>
                                                <div className="p-3">
                                                    <MarkdownRenderer content={step.failureAnalysis.proposedFragment} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                                        Full Error Message
                                    </p>
                                    <pre className="text-xs text-rose-600 font-mono whitespace-pre-wrap">{step.failureAnalysis.errorMessage}</pre>
                                </div>
                            </div>
                        )}
                        {activeTab === "script" && <CodeBlock code={step.scriptContent} />}
                        {activeTab === "context" && (
                            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 shadow-inner">
                                <pre className="text-xs text-orange-600 font-mono overflow-auto max-h-96">
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
        <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
            <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-md">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <button
                            onClick={onBack}
                            className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-700"
                            title="Back to Stream"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Activity className="text-orange-500" size={20} />
                                {isCodeGeneration
                                    ? "Code Generation Report"
                                    : "Test Execution Report"}
                            </h1>
                            <p className="text-xs text-gray-600 mt-1 font-mono">
                                Suite: <span className="text-gray-700">{report.testSuiteId}</span> •
                                {" "}
                                {new Date(report.createdAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <StatusBadge status={report.status} />
                </div>
            </div>

            <div className="max-w-6xl mx-auto w-full px-6 py-10 space-y-10">
                {isCodeGeneration && report.detailedResults?.finalOutput && (
                    <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200">
                        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3 border-b border-gray-200 pb-4">
                            <FileCode className="text-orange-600" /> Generated Deliverables
                        </h2>
                        <MarkdownRenderer content={report.detailedResults.finalOutput} />
                    </div>
                )}

                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3 border-b border-gray-200 pb-4">
                        <Activity className="text-orange-500" /> Execution Diagnostics & Validation
                    </h2>
                    <div className="space-y-4">
                        {steps.length === 0 && (
                            <p className="text-gray-500 italic">
                                No execution steps found in this report.
                            </p>
                        )}
                        {steps.map((step: any) => <StepDetail key={step.stepIndex} step={step} />)}
                    </div>
                </div>
            </div>
        </div>
    );
}
