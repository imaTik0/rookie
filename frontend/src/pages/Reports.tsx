import { useCallback, useEffect, useState } from "react";
import {
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    Loader,
    Trash2,
    XCircle,
    Zap,
    Link2,
} from "lucide-react";
import ReportViewer from "../components/ReportViewer";
import MasterPlanViewer from "../components/MasterPlanViewer";
import { Badge } from "@/components/ui/badge";

const API_BASE = "http://localhost:3000";

interface ListReport {
    id: string;
    testSuiteId: string;
    status: string;
    type?: string;
    createdAt: string;
    masterPlanId?: string;
}

interface MasterPlanListItem {
    id: string;
    projectId: string;
    goals: string[];
    passedCount: number;
    failedCount: number;
    createdAt: string;
}

type ActiveTab = "reports" | "master-plans";

export default function Reports() {
    const [activeTab, setActiveTab] = useState<ActiveTab>("reports");

    // Regular reports state
    const [reports, setReports] = useState<ListReport[]>([]);
    const [reportsTotal, setReportsTotal] = useState(0);
    const [reportsPage, setReportsPage] = useState(1);
    const [loadingReports, setLoadingReports] = useState(true);
    const [selectedReport, setSelectedReport] = useState<any | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Master plans state
    const [masterPlans, setMasterPlans] = useState<MasterPlanListItem[]>([]);
    const [masterPlansTotal, setMasterPlansTotal] = useState(0);
    const [masterPlansPage, setMasterPlansPage] = useState(1);
    const [loadingMasterPlans, setLoadingMasterPlans] = useState(false);
    const [selectedMasterPlan, setSelectedMasterPlan] = useState<any | null>(null);
    const [loadingMasterPlanDetail, setLoadingMasterPlanDetail] = useState(false);

    const limit = 10;

    const fetchReports = useCallback(async () => {
        setLoadingReports(true);
        try {
            const res = await fetch(`${API_BASE}/reports/?page=${reportsPage}&limit=${limit}`);
            const data = await res.json();
            setReports(data);
            setReportsTotal(Number(res.headers.get("X-Total-Count") || data.length));
        } catch {
            setReports([]);
        } finally {
            setLoadingReports(false);
        }
    }, [reportsPage]);

    const fetchMasterPlans = useCallback(async () => {
        setLoadingMasterPlans(true);
        try {
            const res = await fetch(`${API_BASE}/master-plans?page=${masterPlansPage}&limit=${limit}`);
            const data = await res.json();
            setMasterPlans(data.masterPlans || []);
            setMasterPlansTotal(data.total || 0);
        } catch {
            setMasterPlans([]);
        } finally {
            setLoadingMasterPlans(false);
        }
    }, [masterPlansPage]);

    useEffect(() => { fetchReports(); }, [fetchReports]);
    useEffect(() => { if (activeTab === "master-plans") fetchMasterPlans(); }, [activeTab, fetchMasterPlans]);

    const openReport = async (id: string) => {
        setLoadingDetail(true);
        try {
            const res = await fetch(`${API_BASE}/reports/${id}`);
            const data = await res.json();
            setSelectedReport(data);
        } finally {
            setLoadingDetail(false);
        }
    };

    const openMasterPlan = async (id: string) => {
        setLoadingMasterPlanDetail(true);
        try {
            const res = await fetch(`${API_BASE}/master-plans/${id}`);
            const data = await res.json();
            setSelectedMasterPlan(data);
        } finally {
            setLoadingMasterPlanDetail(false);
        }
    };

    const deleteReport = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Delete this report?")) return;
        await fetch(`${API_BASE}/reports/${id}`, { method: "DELETE" });
        fetchReports();
    };

    const deleteMasterPlan = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Delete this Master Plan?")) return;
        await fetch(`${API_BASE}/master-plans/${id}`, { method: "DELETE" });
        fetchMasterPlans();
    };

    // Full-screen viewers
    if (selectedReport) {
        return <ReportViewer report={selectedReport} onBack={() => setSelectedReport(null)} />;
    }
    if (selectedMasterPlan) {
        return (
            <MasterPlanViewer
                plan={selectedMasterPlan}
                onBack={() => setSelectedMasterPlan(null)}
                onOpenReport={(reportId) => {
                    setSelectedMasterPlan(null);
                    openReport(reportId);
                }}
            />
        );
    }

    const reportsTotalPages = Math.ceil(reportsTotal / limit);
    const masterPlansTotalPages = Math.ceil(masterPlansTotal / limit);

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header + Tabs */}
            <div className="p-6 border-b border-gray-200 bg-gray-50 shrink-0">
                <div className="flex items-center gap-3 mb-5">
                    <FileText className="text-orange-500" size={22} />
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
                        <p className="text-sm text-gray-500 mt-0.5">View test execution results and master plan analyses</p>
                    </div>
                </div>
                <div className="flex gap-1 bg-gray-200/60 p-1 rounded-lg w-fit">
                    {(["reports", "master-plans"] as ActiveTab[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            {tab === "reports" ? `Reports${reportsTotal > 0 ? ` (${reportsTotal})` : ""}` : `Master Plans${masterPlansTotal > 0 ? ` (${masterPlansTotal})` : ""}`}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {/* REGULAR REPORTS TAB */}
                {activeTab === "reports" && (
                    <>
                        {loadingReports ? (
                            <div className="flex items-center justify-center h-64">
                                <Loader className="animate-spin text-orange-500" size={32} />
                            </div>
                        ) : reports.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                                <FileText size={48} />
                                <p>No reports yet. Execute a test suite to generate one.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {reports.map((r) => (
                                    <div
                                        key={r.id}
                                        onClick={() => openReport(r.id)}
                                        className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between cursor-pointer hover:border-orange-300 hover:shadow-sm transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl ${r.status === "SUCCESS" ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-rose-500"}`}>
                                                {r.status === "SUCCESS" ? <CheckCircle size={20} /> : <XCircle size={20} />}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-900 group-hover:text-orange-600 transition-colors">
                                                    {r.type === "CODE_GENERATION" ? "Code Generation" : "Test Scenario"}
                                                </p>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                                    <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{r.testSuiteId}</span>
                                                    <span className="flex items-center gap-1"><Clock size={12} />{new Date(r.createdAt).toLocaleString()}</span>
                                                    {r.masterPlanId && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); openMasterPlan(r.masterPlanId!); }}
                                                            className="flex items-center gap-1 text-orange-500 hover:text-orange-700 font-medium"
                                                        >
                                                            <Link2 size={11} /> Master Plan
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${r.status === "SUCCESS" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200"}`}>
                                                {r.status}
                                            </span>
                                            <button onClick={(e) => deleteReport(r.id, e)} className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {reportsTotalPages > 1 && (
                            <div className="mt-6 flex items-center justify-between">
                                <p className="text-sm text-gray-500">Page {reportsPage} of {reportsTotalPages}</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setReportsPage(p => Math.max(1, p - 1))} disabled={reportsPage <= 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                        <ChevronLeft size={16} />
                                    </button>
                                    <button onClick={() => setReportsPage(p => Math.min(reportsTotalPages, p + 1))} disabled={reportsPage >= reportsTotalPages} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* MASTER PLANS TAB */}
                {activeTab === "master-plans" && (
                    <>
                        {loadingMasterPlans ? (
                            <div className="flex items-center justify-center h-64">
                                <Loader className="animate-spin text-orange-500" size={32} />
                            </div>
                        ) : masterPlans.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                                <Zap size={48} />
                                <p>No Master Plans yet. Run one from the Master Planner page.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {masterPlans.map((mp) => {
                                    const total = mp.goals.length;
                                    const passRate = total > 0 ? mp.passedCount / total : 0;
                                    return (
                                        <div
                                            key={mp.id}
                                            onClick={() => openMasterPlan(mp.id)}
                                            className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:border-orange-300 hover:shadow-sm transition-all group"
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2.5 rounded-xl bg-orange-50 text-orange-500">
                                                        <Zap size={20} />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-gray-900 group-hover:text-orange-600 transition-colors">Master Plan</p>
                                                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                            <Clock size={11} /> {new Date(mp.createdAt).toLocaleString()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">
                                                        {mp.passedCount} passed
                                                    </Badge>
                                                    {mp.failedCount > 0 && (
                                                        <Badge variant="outline" className="border-red-200 text-red-600 bg-red-50">
                                                            {mp.failedCount} failed
                                                        </Badge>
                                                    )}
                                                    <button onClick={(e) => deleteMasterPlan(mp.id, e)} className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                            {/* Mini goals preview */}
                                            <div className="flex flex-wrap gap-1.5 mb-3">
                                                {mp.goals.slice(0, 4).map((g, i) => (
                                                    <span key={i} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full border border-gray-200 max-w-[200px] truncate">{g}</span>
                                                ))}
                                                {mp.goals.length > 4 && <span className="text-xs px-2 py-0.5 text-gray-400">+{mp.goals.length - 4} more</span>}
                                            </div>
                                            {/* Pass rate bar */}
                                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${passRate * 100}%` }} />
                                            </div>
                                            <p className="text-xs text-gray-400 mt-1">{Math.round(passRate * 100)}% pass rate · {total} goals</p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {masterPlansTotalPages > 1 && (
                            <div className="mt-6 flex items-center justify-between">
                                <p className="text-sm text-gray-500">Page {masterPlansPage} of {masterPlansTotalPages}</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setMasterPlansPage(p => Math.max(1, p - 1))} disabled={masterPlansPage <= 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                        <ChevronLeft size={16} />
                                    </button>
                                    <button onClick={() => setMasterPlansPage(p => Math.min(masterPlansTotalPages, p + 1))} disabled={masterPlansPage >= masterPlansTotalPages} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {loadingDetail && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-3">
                        <Loader className="animate-spin text-orange-500" size={32} />
                        <p className="text-sm text-gray-600">Loading report...</p>
                    </div>
                </div>
            )}
            {loadingMasterPlanDetail && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-3">
                        <Loader className="animate-spin text-orange-500" size={32} />
                        <p className="text-sm text-gray-600">Loading Master Plan...</p>
                    </div>
                </div>
            )}
        </div>
    );
}
