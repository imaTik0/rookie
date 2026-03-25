import { useState, useEffect, useCallback } from 'react';
import { FileText, ChevronLeft, ChevronRight, Trash2, CheckCircle, XCircle, Loader, Clock } from 'lucide-react';
import ReportViewer from '../components/ReportViewer';

const API_BASE = 'http://localhost:3000';

interface ListReport {
  id: string;
  testSuiteId: string;
  status: string;
  type?: string;
  createdAt: string;
}

export default function Reports() {
  const [reports, setReports] = useState<ListReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const limit = 10;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/reports/?page=${page}&limit=${limit}`);
      const data = await res.json();
      setReports(data);
      setTotal(Number(res.headers.get('X-Total-Count') || data.length));
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
      const res = await fetch(`${API_BASE}/reports/${id}`);
      const data = await res.json();
      setSelectedReport(data);
    } catch {
      // handle silently
    } finally {
      setLoadingDetail(false);
    }
  };

  const deleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this report?')) return;
    await fetch(`${API_BASE}/reports/${id}`, { method: 'DELETE' });
    fetchReports();
  };

  const totalPages = Math.ceil(total / limit);

  if (selectedReport) {
    return <ReportViewer report={selectedReport} onBack={() => setSelectedReport(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <FileText className="text-orange-500" size={22} />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reports</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} report{total !== 1 ? 's' : ''} found</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
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
            {reports.map(r => (
              <div
                key={r.id}
                onClick={() => openReport(r.id)}
                className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between cursor-pointer hover:border-orange-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2.5 rounded-xl ${
                    r.status === 'SUCCESS' 
                      ? 'bg-emerald-50 text-emerald-500' 
                      : 'bg-rose-50 text-rose-500'
                  }`}>
                    {r.status === 'SUCCESS' ? <CheckCircle size={20} /> : <XCircle size={20} />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 group-hover:text-orange-600 transition-colors">
                      {r.type === 'CODE_GENERATION' ? 'Code Generation' : 'Test Scenario'}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{r.testSuiteId}</span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                    r.status === 'SUCCESS'
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : 'bg-rose-50 text-rose-600 border-rose-200'
                  }`}>
                    {r.status}
                  </span>
                  <button
                    onClick={(e) => deleteReport(r.id, e)}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete report"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {loadingDetail && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader className="animate-spin text-orange-500" size={32} />
            <p className="text-sm text-gray-600">Loading report...</p>
          </div>
        </div>
      )}
    </div>
  );
}
