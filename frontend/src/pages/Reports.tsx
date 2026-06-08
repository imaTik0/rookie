import { useCallback, useEffect, useState } from "react";
import {
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    Loader2,
    Trash2,
    XCircle,
    Zap,
    Link2,
    Database,
} from "lucide-react";
import ReportViewer from "../components/ReportViewer";
import MasterPlanViewer from "../components/MasterPlanViewer";

const API = "http://localhost:3000";

interface ListReport {
    id: string;
    testSuiteId?: string;
    status: string;
    type?: string;
    createdAt: string;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    structuredSummary?: {
        goalsBreakdown?: { status: string }[];
    };
}

export default function Reports() {
    const [reports, setReports] = useState<ListReport[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<any>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const limit = 10;

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/reports?page=${page}&limit=${limit}`);
            const data = await res.json();
            // API now returns the standard { items, meta } pagination envelope.
            setReports(data.items ?? []);
            setTotal(data.meta?.totalItems ?? data.items?.length ?? 0);
        } catch {
            setReports([]);
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => { fetchReports(); }, [fetchReports]);

    const openReport = async (id: string) => {
        setLoadingDetail(true);
        try {
            const res = await fetch(`${API}/reports/${id}`);
            setDetail(await res.json());
        } finally {
            setLoadingDetail(false);
        }
    };

    const deleteReport = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Delete this report?")) return;
        await fetch(`${API}/reports/${id}`, { method: "DELETE" });
        fetchReports();
    };

    if (detail) {
        if (detail.type === "MASTER_PLAN") {
            return (
                <MasterPlanViewer
                    plan={detail}
                    onBack={() => setDetail(null)}
                    onOpenReport={(id) => { setDetail(null); openReport(id); }}
                />
            );
        }
        return <ReportViewer report={detail} onBack={() => setDetail(null)} />;
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <div className="flex-1 flex flex-col h-full animate-enter">
            {/* Header */}
            <div className="h-20 border-b border-white/5 flex items-center px-8 shrink-0 bg-[#151517]/40 backdrop-blur-xl sticky top-0 z-10 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg shadow-blue-500/20">
                        <Database size={18} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-white tracking-tight">System Reports</h1>
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5">Total logs indexed: {total}</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
                {loading ? (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                        <Loader2 className="animate-spin" size={24} />
                    </div>
                ) : reports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-4 glass-panel rounded-3xl">
                        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                            <FileText size={24} className="text-gray-400" />
                        </div>
                        <p className="text-sm font-medium">No reports generated yet</p>
                    </div>
                ) : (
                    <div className="glass-panel rounded-3xl divide-y divide-white/5 shadow-2xl overflow-hidden">
                        {reports.map((r) => (
                            <div
                                key={r.id}
                                onClick={() => openReport(r.id)}
                                className="px-6 py-5 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer group"
                            >
                                <div className="flex items-center gap-5 min-w-0">
                                    <div className="shrink-0 p-3 rounded-2xl bg-[#151517]/40 border border-white/5 shadow-inner">
                                        {r.type === "MASTER_PLAN" ? (
                                            <Zap size={20} className="text-gray-400" />
                                        ) : r.status === "SUCCESS" ? (
                                            <CheckCircle size={20} className="text-emerald-400" />
                                        ) : (
                                            <XCircle size={20} className="text-rose-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-gray-200 group-hover:text-white transition-colors flex items-center gap-3">
                                            {r.type === "MASTER_PLAN" ? "Master Plan" : r.type === "CODE_GENERATION" ? "Code Generation" : "Test Scenario"}
                                            {r.masterPlanId && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openReport(r.masterPlanId!); }}
                                                    className="text-[10px] text-gray-400 hover:text-gray-300 bg-gray-500/10 hover:bg-gray-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors border border-gray-500/20"
                                                >
                                                    <Link2 size={10} /> Link to Plan
                                                </button>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-gray-500 font-mono mt-1 flex items-center gap-4">
                                            <span className="flex items-center gap-1"><Clock size={12} className="text-gray-600" />{new Date(r.createdAt).toLocaleString()}</span>
                                            {r.testSuiteId && <span className="text-gray-400 bg-[#151517]/50 px-2 py-0.5 rounded">{r.testSuiteId.substring(0, 8)}</span>}
                                            {r.type === "MASTER_PLAN" && r.masterPlanGoals && (
                                                <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{r.masterPlanGoals.length} goals</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 shrink-0">
                                    {r.type === "MASTER_PLAN" && r.structuredSummary?.goalsBreakdown && (() => {
                                        const passed = r.structuredSummary!.goalsBreakdown!.filter(g => g.status === "SUCCESS").length;
                                        const total = r.structuredSummary!.goalsBreakdown!.length;
                                        return (
                                            <div className="flex flex-col items-end gap-1 mr-4">
                                                <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Pass Rate</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                        <div className="h-full bg-emerald-400" style={{ width: `${(passed/total)*100}%` }} />
                                                    </div>
                                                    <span className="text-[11px] font-mono text-emerald-400 font-bold">{Math.round((passed/total)*100)}%</span>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <span className={`text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded-lg border shadow-inner ${
                                        r.status === "SUCCESS"
                                            ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/10 shadow-emerald-500/10"
                                            : r.status === "FAILED"
                                                ? "border-rose-500/20 text-rose-400 bg-rose-500/10 shadow-rose-500/10"
                                                : "border-gray-500/20 text-gray-400 bg-white/5"
                                    }`}>
                                        {r.status}
                                    </span>

                                    <button
                                        onClick={(e) => deleteReport(r.id, e)}
                                        className="p-2 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                        title="Delete Log"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-between">
                        <span className="text-[11px] text-gray-500 font-mono uppercase tracking-widest">Page {page} of {totalPages}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all shadow-lg shadow-white/5 active:scale-95"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all shadow-lg shadow-white/5 active:scale-95"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {loadingDetail && (
                <div className="absolute inset-0 bg-[#151517]/60 backdrop-blur-sm flex items-center justify-center z-50 animate-enter">
                    <Loader2 className="animate-spin text-gray-500" size={32} />
                </div>
            )}
        </div>
    );
}
