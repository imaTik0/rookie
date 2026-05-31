import { useState } from "react";
import {
    ArrowLeft,
    BookOpen,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    FileSearch,
    Lightbulb,
    TrendingDown,
    XCircle,
    Zap,
} from "lucide-react";
import { marked } from "marked";

const GAP_COLORS: Record<string, string> = {
    MISSING: "bg-red-500/80",
    INCORRECT: "bg-gray-500/80",
    AMBIGUOUS: "bg-yellow-400/80",
    CONFIG: "bg-blue-500/80",
    UNKNOWN: "bg-neutral-500",
};

const GAP_TEXT_COLORS: Record<string, string> = {
    MISSING: "text-red-400 border-red-500/30 bg-red-500/10",
    INCORRECT: "text-gray-400 border-gray-500/30 bg-gray-500/10",
    AMBIGUOUS: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
    CONFIG: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    UNKNOWN: "text-neutral-400 border-neutral-500/30 bg-neutral-500/10",
};

interface MasterPlanDetail {
    id: string;
    projectId: string;
    masterPlanGoals?: string[];
    masterPlanReports?: string[];
    detailedResults?: { finalOutput?: string };
    createdAt: string;
    structuredSummary?: {
        executiveSummary: string;
        overallPassRate: number;
        failureTaxonomy: Record<string, number>;
        topFailingFunctions: { functionName: string; count: number; goals: string[] }[];
        goalsBreakdown: { goal: string; status: string; reportId: string | null; keyFindings: string }[];
        documentationGapDetails: { fragment: string; proposedFix: string; affectedGoals: string[]; file?: string }[];
        recommendations: string[];
    };
}

export default function MasterPlanViewer({
    plan,
    onBack,
    onOpenReport,
}: {
    plan: MasterPlanDetail;
    onBack: () => void;
    onOpenReport: (reportId: string) => void;
}) {
    const [expandedGap, setExpandedGap] = useState<number | null>(null);
    const s = plan.structuredSummary;

    const passRate = s ? s.overallPassRate : 0;
    const passedCount = s ? s.goalsBreakdown.filter(g => g.status === "SUCCESS").length : 0;
    const failedCount = s ? s.goalsBreakdown.filter(g => g.status !== "SUCCESS").length : 0;
    const totalGoals = plan.masterPlanGoals?.length || 0;

    const totalTaxonomy = s ? Object.values(s.failureTaxonomy).reduce((a, b) => a + b, 0) : 0;

    return (
        <div className="flex flex-col h-full bg-[#1c1c1e] text-gray-200 overflow-y-auto font-sans selection:bg-white/20">
            {/* Header */}
            <div className="border-b border-white/10 sticky top-0 z-20 bg-[#151517]/40 backdrop-blur-xl transition-all duration-300">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-300 active:scale-95 hover:shadow-lg hover:shadow-white/5"
                        >
                            <ArrowLeft size={16} />
                        </button>
                        <div>
                            <h1 className="text-base font-semibold flex items-center gap-2 bg-gradient-to-r from-gray-200 to-gray-500 bg-clip-text text-transparent">
                                <Zap className="text-gray-500/80" size={16} />
                                Master Plan Report
                            </h1>
                            <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                                {plan.id} · {new Date(plan.createdAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-gray-400">{Math.round(passRate * 100)}% PASS</span>
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-medium border backdrop-blur-sm transition-all duration-300 ${passRate >= 0.7 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : passRate >= 0.4 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                            {passedCount}/{totalGoals}
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-4">
                    {[
                        { label: "Total Goals", value: totalGoals, icon: <BookOpen size={16} />, color: "text-gray-400" },
                        { label: "Passed", value: passedCount, icon: <CheckCircle2 size={16} />, color: "text-emerald-400" },
                        { label: "Failed", value: failedCount, icon: <XCircle size={16} />, color: "text-red-400" },
                        { label: "Doc Gaps", value: s?.documentationGapDetails.length ?? 0, icon: <FileSearch size={16} />, color: "text-gray-400" },
                    ].map(stat => (
                        <div key={stat.label} className="bg-white/5 border border-white/10 rounded-xl p-5 backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                            <div className={`flex items-center gap-2 mb-3 ${stat.color}`}>
                                {stat.icon}
                                <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">{stat.label}</span>
                            </div>
                            <p className={`text-3xl font-mono font-bold ${stat.color} drop-shadow-sm`}>{stat.value}</p>
                        </div>
                    ))}
                </div>

                {/* Overall pass rate bar */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-5 backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Overall Pass Rate</span>
                        <span className="text-sm font-mono font-bold text-gray-200">{Math.round(passRate * 100)}%</span>
                    </div>
                    <div className="h-2 bg-[#151517]/50 rounded-full overflow-hidden border border-white/5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                            style={{ width: `${passRate * 100}%` }}
                        />
                    </div>
                </div>

                {/* Executive Summary */}
                {s?.executiveSummary && (
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                        <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                            <Zap size={14} className="text-gray-500/80" />
                            <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Executive Summary</span>
                        </div>
                        <div className="p-5">
                            <div
                                className="prose prose-invert prose-sm max-w-none text-sm text-gray-400 leading-relaxed [&_h1]:text-gray-200 [&_h2]:text-gray-200 [&_h3]:text-gray-200 [&_strong]:text-gray-300 [&_a]:text-gray-400/80 [&_a:hover]:text-gray-300 [&_code]:text-gray-300 [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                                dangerouslySetInnerHTML={{ __html: marked.parse(s.executiveSummary) as string }}
                            />
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                    {/* Failure Taxonomy */}
                    {s && totalTaxonomy > 0 && (
                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300 flex flex-col">
                            <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                                <TrendingDown size={14} className="text-gray-400" />
                                <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Failure Taxonomy</span>
                            </div>
                            <div className="p-5 space-y-4 flex-1">
                                {Object.entries(s.failureTaxonomy)
                                    .filter(([, v]) => v > 0)
                                    .sort(([, a], [, b]) => b - a)
                                    .map(([gap, count]) => (
                                        <div key={gap} className="group">
                                            <div className="flex justify-between text-xs mb-2">
                                                <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border backdrop-blur-sm transition-all duration-300 ${GAP_TEXT_COLORS[gap] ?? "text-neutral-400 border-neutral-500/30 bg-neutral-500/10"}`}>
                                                    {gap}
                                                </span>
                                                <span className="text-gray-500 font-mono text-[11px] group-hover:text-gray-400 transition-colors">{count} {count === 1 ? "issue" : "issues"}</span>
                                            </div>
                                            <div className="h-1.5 bg-[#151517]/50 rounded-full overflow-hidden border border-white/5">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ease-out ${GAP_COLORS[gap] ?? "bg-neutral-500"}`}
                                                    style={{ width: `${(count / totalTaxonomy) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* Top Failing Functions */}
                    {s && s.topFailingFunctions.length > 0 && (
                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300 flex flex-col">
                            <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                                <XCircle size={14} className="text-red-400/80" />
                                <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Top Failing Functions</span>
                            </div>
                            <div className="p-5 max-h-[260px] overflow-y-auto space-y-2 flex-1">
                                {s.topFailingFunctions.slice(0, 8).map((fn, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-[#151517]/40 rounded-lg border border-white/5 hover:border-white/20 transition-all duration-300">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-[10px] font-mono text-gray-500 w-5 shrink-0">#{i + 1}</span>
                                            <code className="text-xs font-mono text-gray-300 truncate bg-white/5 px-2 py-1 rounded-md">{fn.functionName}</code>
                                        </div>
                                        <span className="text-[10px] font-mono shrink-0 ml-3 px-2 py-1 rounded-md border border-red-500/20 text-red-400 bg-red-500/10">
                                            {fn.count}✕
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Goals Breakdown */}
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                    <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                        <BookOpen size={14} className="text-gray-400" />
                        <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Goals Breakdown</span>
                    </div>
                    <div className="divide-y divide-white/10">
                        {(s?.goalsBreakdown ?? (plan.masterPlanGoals || []).map(g => ({ goal: g, status: "UNKNOWN", reportId: null, keyFindings: "" }))).map((item, idx) => (
                            <div key={idx} className="flex items-start gap-4 p-4 hover:bg-white/[0.04] transition-all duration-300 group">
                                <div className="mt-1 shrink-0 transition-transform group-hover:scale-110 duration-300">
                                    {item.status === "SUCCESS"
                                        ? <CheckCircle2 size={16} className="text-emerald-400" />
                                        : <XCircle size={16} className="text-red-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-200 mb-1 leading-snug">{item.goal}</p>
                                    {item.keyFindings && (
                                        <p className="text-xs text-gray-500 leading-relaxed group-hover:text-gray-400 transition-colors">{item.keyFindings}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border backdrop-blur-sm transition-colors ${item.status === "SUCCESS" ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/10" : "border-red-500/20 text-red-400 bg-red-500/10"}`}>
                                        {item.status}
                                    </span>
                                    {item.reportId && (
                                        <button
                                            onClick={() => onOpenReport(item.reportId!)}
                                            className="inline-flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-white font-mono border border-white/10 hover:border-white/30 hover:bg-white/5 px-2.5 py-1 rounded-md transition-all duration-300 active:scale-95"
                                        >
                                            Report <ExternalLink size={10} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Documentation Gaps */}
                {s && s.documentationGapDetails.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                        <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                            <FileSearch size={14} className="text-gray-400/80" />
                            <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Documentation Gaps</span>
                            <span className="text-[10px] font-mono text-gray-500 ml-1 bg-white/5 px-1.5 rounded">({s.documentationGapDetails.length})</span>
                        </div>
                        <div className="divide-y divide-white/10">
                            {s.documentationGapDetails.map((gap, idx) => (
                                <div key={idx} className="transition-colors hover:bg-white/[0.02]">
                                    <button
                                        onClick={() => setExpandedGap(expandedGap === idx ? null : idx)}
                                        className="w-full text-left flex items-center justify-between gap-4 p-4 group"
                                    >
                                        <div className="flex items-start gap-3 min-w-0">
                                            <span className="shrink-0 mt-0.5 w-5 h-5 bg-gray-500/10 border border-gray-500/20 rounded-md flex items-center justify-center text-gray-400 text-[10px] font-mono group-hover:bg-gray-500/20 transition-colors">
                                                {idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-[11px] text-gray-500 mb-1 font-mono">{gap.file ?? "Unknown file"} <span className="text-gray-600 mx-1">·</span> {gap.affectedGoals.slice(0, 2).join(", ")}{gap.affectedGoals.length > 2 ? ` +${gap.affectedGoals.length - 2}` : ""}</p>
                                                <p className="text-xs font-mono text-gray-400 truncate group-hover:text-gray-300 transition-colors">"{gap.fragment.substring(0, 120)}{gap.fragment.length > 120 ? "..." : ""}"</p>
                                            </div>
                                        </div>
                                        <div className="p-1.5 rounded-md bg-white/5 text-gray-400 group-hover:bg-white/10 group-hover:text-white transition-all duration-300">
                                            {expandedGap === idx
                                                ? <ChevronDown size={14} className="shrink-0" />
                                                : <ChevronRight size={14} className="shrink-0" />}
                                        </div>
                                    </button>
                                    <div
                                        className={`overflow-hidden transition-all duration-300 ease-in-out ${
                                            expandedGap === idx ? "max-h-[2000px] opacity-100 pb-4" : "max-h-0 opacity-0"
                                        }`}
                                    >
                                        <div className="ml-12 mr-4 space-y-4">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-widest text-red-400 font-medium mb-2 flex items-center gap-1.5"><TrendingDown size={10} /> Problematic Fragment</p>
                                                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 backdrop-blur-sm">
                                                    <pre className="text-xs text-red-300/90 font-mono whitespace-pre-wrap overflow-x-auto">{gap.fragment}</pre>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-medium mb-2 flex items-center gap-1.5"><CheckCircle2 size={10} /> Proposed Fix</p>
                                                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 backdrop-blur-sm">
                                                    <pre className="text-xs text-emerald-300/90 font-mono whitespace-pre-wrap overflow-x-auto">{gap.proposedFix}</pre>
                                                </div>
                                            </div>
                                            {gap.affectedGoals.length > 0 && (
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-medium mb-2">Affected Goals</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {gap.affectedGoals.map((g, i) => (
                                                            <span key={i} className="text-[10px] font-mono px-2 py-1 bg-white/5 text-gray-400 rounded-md border border-white/10 hover:bg-white/10 transition-colors">{g}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recommendations */}
                {s && s.recommendations.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                        <div className="border-b border-white/10 px-5 py-4 flex items-center gap-2 bg-white/[0.02]">
                            <Lightbulb size={14} className="text-yellow-400/80" />
                            <span className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Recommendations</span>
                        </div>
                        <div className="p-5">
                            <ol className="space-y-3">
                                {s.recommendations.map((rec, i) => (
                                    <li key={i} className="flex items-start gap-3 group">
                                        <span className="shrink-0 mt-0.5 w-5 h-5 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-gray-500 group-hover:bg-white/10 group-hover:text-gray-300 transition-colors">{i + 1}</span>
                                        <p className="text-sm text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">{rec}</p>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                )}

                {/* Fallback: show raw finalSummary if no structured data */}
                {!s && plan.detailedResults?.finalOutput && (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-white/5 transition-all duration-300">
                        <div
                            className="prose prose-invert prose-sm max-w-none text-sm text-gray-400 leading-relaxed [&_h1]:text-gray-200 [&_h2]:text-gray-200 [&_h3]:text-gray-200 [&_strong]:text-gray-300 [&_a]:text-gray-400/80 [&_a:hover]:text-gray-300 [&_code]:text-gray-300 [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                            dangerouslySetInnerHTML={{ __html: marked.parse(plan.detailedResults.finalOutput) as string }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
