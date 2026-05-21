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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";



const GAP_COLORS: Record<string, string> = {
    MISSING: "bg-red-500",
    INCORRECT: "bg-orange-500",
    AMBIGUOUS: "bg-yellow-400",
    CONFIG: "bg-blue-500",
    UNKNOWN: "bg-gray-400",
};

const GAP_TEXT_COLORS: Record<string, string> = {
    MISSING: "text-red-600 border-red-200 bg-red-50",
    INCORRECT: "text-orange-600 border-orange-200 bg-orange-50",
    AMBIGUOUS: "text-yellow-700 border-yellow-200 bg-yellow-50",
    CONFIG: "text-blue-600 border-blue-200 bg-blue-50",
    UNKNOWN: "text-gray-600 border-gray-200 bg-gray-50",
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
        <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-700"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Zap className="text-orange-500" size={20} />
                                Master Plan Report
                            </h1>
                            <p className="text-xs text-gray-500 font-mono mt-0.5">
                                {plan.id} • {new Date(plan.createdAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-gray-700">{Math.round(passRate * 100)}% Pass Rate</span>
                        <div className={`px-3 py-1 rounded-full text-xs font-bold border ${passRate >= 0.7 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : passRate >= 0.4 ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                            {passedCount} / {totalGoals} Passed
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto w-full px-6 py-8 space-y-8">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-4">
                    {[
                        { label: "Total Goals", value: totalGoals, icon: <BookOpen size={18} />, color: "text-gray-700" },
                        { label: "Passed", value: passedCount, icon: <CheckCircle2 size={18} />, color: "text-emerald-600" },
                        { label: "Failed", value: failedCount, icon: <XCircle size={18} />, color: "text-red-500" },
                        { label: "Doc Gaps Found", value: s?.documentationGapDetails.length ?? 0, icon: <FileSearch size={18} />, color: "text-orange-500" },
                    ].map(stat => (
                        <Card key={stat.label} className="border-none shadow-sm bg-white">
                            <CardContent className="pt-5 pb-4 px-5">
                                <div className={`flex items-center gap-2 mb-1 ${stat.color}`}>
                                    {stat.icon}
                                    <span className="text-xs uppercase tracking-wider font-semibold text-gray-500">{stat.label}</span>
                                </div>
                                <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Overall pass rate bar */}
                <Card className="border-none shadow-sm bg-white">
                    <CardContent className="pt-5 pb-5 px-5">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-gray-700">Overall Pass Rate</span>
                            <span className="text-sm font-bold text-gray-900">{Math.round(passRate * 100)}%</span>
                        </div>
                        <Progress value={passRate * 100} className="h-3 bg-gray-100 [&>div]:bg-emerald-500" />
                    </CardContent>
                </Card>

                {/* Executive Summary */}
                {s?.executiveSummary && (
                    <Card className="border-none shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-orange-50/50 border-b border-orange-100 py-4 px-5">
                            <CardTitle className="text-base font-semibold text-orange-700 flex items-center gap-2">
                                <Zap size={16} /> Executive Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-5 px-5 pb-5">
                            <div
                                className="prose prose-sm prose-slate max-w-none text-gray-700"
                                dangerouslySetInnerHTML={{ __html: marked.parse(s.executiveSummary) as string }}
                            />
                        </CardContent>
                    </Card>
                )}

                <div className="grid grid-cols-2 gap-6">
                    {/* Failure Taxonomy */}
                    {s && totalTaxonomy > 0 && (
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="bg-gray-50 border-b border-gray-100 py-4 px-5">
                                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                    <TrendingDown size={16} /> Failure Taxonomy
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 px-5 pb-5 space-y-3">
                                {Object.entries(s.failureTaxonomy)
                                    .filter(([, v]) => v > 0)
                                    .sort(([, a], [, b]) => b - a)
                                    .map(([gap, count]) => (
                                        <div key={gap}>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className={`font-semibold px-2 py-0.5 rounded border text-xs ${GAP_TEXT_COLORS[gap] ?? "text-gray-600 border-gray-200 bg-gray-50"}`}>
                                                    {gap}
                                                </span>
                                                <span className="text-gray-600 font-medium">{count} {count === 1 ? "issue" : "issues"}</span>
                                            </div>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all ${GAP_COLORS[gap] ?? "bg-gray-400"}`}
                                                    style={{ width: `${(count / totalTaxonomy) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Top Failing Functions */}
                    {s && s.topFailingFunctions.length > 0 && (
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="bg-gray-50 border-b border-gray-100 py-4 px-5">
                                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                    <XCircle size={16} className="text-red-400" /> Top Failing Functions
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 px-5 pb-5">
                                <ScrollArea className="h-[200px]">
                                    <div className="space-y-2 pr-2">
                                        {s.topFailingFunctions.slice(0, 8).map((fn, i) => (
                                            <div key={i} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs font-bold text-gray-400 w-5 shrink-0">#{i + 1}</span>
                                                    <code className="text-xs font-mono text-gray-800 truncate">{fn.functionName}</code>
                                                </div>
                                                <Badge variant="outline" className="text-xs shrink-0 ml-2 border-red-200 text-red-600 bg-red-50">
                                                    {fn.count}✕
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Goals Breakdown */}
                <Card className="border-none shadow-sm bg-white overflow-hidden">
                    <CardHeader className="bg-gray-50 border-b border-gray-100 py-4 px-5">
                        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                            <BookOpen size={16} /> Goals Breakdown
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-gray-100">
                            {(s?.goalsBreakdown ?? (plan.masterPlanGoals || []).map(g => ({ goal: g, status: "UNKNOWN", reportId: null, keyFindings: "" }))).map((item, idx) => (
                                <div key={idx} className="flex items-start gap-4 p-4 hover:bg-gray-50/60 transition-colors">
                                    <div className="mt-0.5 shrink-0">
                                        {item.status === "SUCCESS"
                                            ? <CheckCircle2 size={18} className="text-emerald-500" />
                                            : <XCircle size={18} className="text-red-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">{item.goal}</p>
                                        {item.keyFindings && (
                                            <p className="text-xs text-gray-500 leading-relaxed">{item.keyFindings}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge variant="outline" className={item.status === "SUCCESS" ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-red-200 text-red-600 bg-red-50"}>
                                            {item.status}
                                        </Badge>
                                        {item.reportId && (
                                            <button
                                                onClick={() => onOpenReport(item.reportId!)}
                                                className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 font-medium border border-orange-200 bg-orange-50 hover:bg-orange-100 px-2.5 py-1 rounded-md transition-colors"
                                            >
                                                View Report <ExternalLink size={11} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Documentation Gaps */}
                {s && s.documentationGapDetails.length > 0 && (
                    <Card className="border-none shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-red-50/50 border-b border-red-100 py-4 px-5">
                            <CardTitle className="text-base font-semibold text-red-700 flex items-center gap-2">
                                <FileSearch size={16} /> Documentation Gaps ({s.documentationGapDetails.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-gray-100">
                                {s.documentationGapDetails.map((gap, idx) => (
                                    <div key={idx} className="p-4">
                                        <button
                                            onClick={() => setExpandedGap(expandedGap === idx ? null : idx)}
                                            className="w-full text-left flex items-center justify-between gap-3 group"
                                        >
                                            <div className="flex items-start gap-3 min-w-0">
                                                <div className="shrink-0 mt-0.5 w-5 h-5 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-xs font-bold">
                                                    {idx + 1}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs text-gray-500 mb-1">{gap.file ?? "Unknown file"} · Affects: {gap.affectedGoals.slice(0, 2).join(", ")}{gap.affectedGoals.length > 2 ? ` +${gap.affectedGoals.length - 2} more` : ""}</p>
                                                    <p className="text-sm font-mono text-gray-700 italic truncate">"{gap.fragment.substring(0, 120)}{gap.fragment.length > 120 ? "..." : ""}"</p>
                                                </div>
                                            </div>
                                            {expandedGap === idx
                                                ? <ChevronDown size={16} className="text-gray-400 shrink-0" />
                                                : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                                        </button>
                                        {expandedGap === idx && (
                                            <div className="mt-4 ml-8 space-y-3">
                                                <div>
                                                    <p className="text-xs uppercase tracking-wider text-red-600 font-semibold mb-2">Problematic Fragment</p>
                                                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                                        <pre className="text-xs text-red-800 font-mono whitespace-pre-wrap">{gap.fragment}</pre>
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-xs uppercase tracking-wider text-emerald-600 font-semibold mb-2">Proposed Fix</p>
                                                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                                                        <pre className="text-xs text-emerald-800 font-mono whitespace-pre-wrap">{gap.proposedFix}</pre>
                                                    </div>
                                                </div>
                                                {gap.affectedGoals.length > 0 && (
                                                    <div>
                                                        <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">Affected Goals</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {gap.affectedGoals.map((g, i) => (
                                                                <span key={i} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded border border-gray-200">{g}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Recommendations */}
                {s && s.recommendations.length > 0 && (
                    <Card className="border-none shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-blue-50/50 border-b border-blue-100 py-4 px-5">
                            <CardTitle className="text-base font-semibold text-blue-700 flex items-center gap-2">
                                <Lightbulb size={16} /> Recommendations
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 pb-5 px-5">
                            <ol className="space-y-3">
                                {s.recommendations.map((rec, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                                        <p className="text-sm text-gray-700 leading-relaxed">{rec}</p>
                                    </li>
                                ))}
                            </ol>
                        </CardContent>
                    </Card>
                )}

                {/* Fallback: show raw finalSummary if no structured data */}
                {!s && plan.detailedResults?.finalOutput && (
                    <Card className="border-none shadow-sm bg-white">
                        <CardContent className="pt-6 pb-6 px-6">
                            <div
                                className="prose prose-sm prose-slate max-w-none"
                                dangerouslySetInnerHTML={{ __html: marked.parse(plan.detailedResults.finalOutput) as string }}
                            />
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
