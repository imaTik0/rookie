import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Folder, FileCode2, Activity, Plus } from 'lucide-react';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [testSuites, setTestSuites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3000/projects').then(res => res.json()),
      fetch('http://localhost:3000/testsuites').then(res => res.json())
    ])
    .then(([projs, suites]) => {
      setProjects(projs.projects || []);
      setTestSuites(suites.testSuites || []);
      setLoading(false);
    })
    .catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-10 max-w-6xl w-full mx-auto h-full overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Platform Overview</h1>
          <p className="text-slate-400">Manage vector contexts and execution engines</p>
        </div>
        <Link to="/project/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-md transition-colors text-sm">
          <Plus size={18} /> Add Project
        </Link>
      </div>

      {loading ? (
        <div className="text-slate-500 animate-pulse">Scanning infrastructure...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm shadow-black/20">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
              <h2 className="text-xl font-semibold flex items-center gap-2 text-white">
                <Folder className="text-blue-400" /> Projects Matrix
              </h2>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {projects.length === 0 ? <p className="text-slate-500 text-sm">Empty vector store. Ingest documentation to begin.</p> : null}
              {projects.map((p: any) => (
                <div key={p.id} className="flex flex-col p-4 bg-slate-950 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors group">
                  <div className="flex justify-between items-start">
                    <span className="font-semibold text-white group-hover:text-blue-400 transition-colors">{p.projectName}</span>
                    <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-1 rounded">{p.id}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded flex items-center gap-1">
                      <Folder size={12} /> {p.files?.length || 0} Files
                    </span>
                    <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded">
                      Vectors Ingested
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm shadow-black/20">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
              <h2 className="text-xl font-semibold flex items-center gap-2 text-white">
                <FileCode2 className="text-purple-400" /> Test Suites Hub
              </h2>
              <Link to="/testsuite/new" className="text-sm text-purple-400 hover:text-purple-300 font-medium">Deploy New</Link>
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {testSuites.length === 0 ? <p className="text-slate-500 text-sm">No agentic tests tracked.</p> : null}
              {testSuites.map((ts: any) => (
                <div key={ts.id} className="flex gap-4 p-4 bg-slate-950 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex-1">
                    <span className="font-semibold text-white block mb-1">{ts.userGoal || 'Autonomous API Scenario'}</span>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-2">
                      <span className="bg-purple-900/30 text-purple-400 px-2 py-1 rounded font-mono">{ts.mode}</span>
                      <span className="truncate max-w-[120px] font-mono text-[10px]" title={ts.projectId}>{ts.projectId}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center border-l border-slate-800 pl-4">
                    <Link to={`/execute/${ts.id}`} className="w-10 h-10 flex items-center justify-center bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-full transition-all" title="Launch Execution Stream">
                      <Activity size={18} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
