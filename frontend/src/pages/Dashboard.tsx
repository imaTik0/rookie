import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, FileCode2, Folder, Plus } from "lucide-react";

export default function Dashboard() {
    const [projects, setProjects] = useState([]);
    const [testSuites, setTestSuites] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch("http://localhost:3000/projects").then((res) => res.json()),
            fetch("http://localhost:3000/testsuites").then((res) => res.json()),
        ])
            .then(([projs, suites]) => {
                setProjects(projs.projects || []);
                setTestSuites(suites.testSuites || []);
                setLoading(false);
            })
            .catch((err) => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    return (
        <div className="p-10 max-w-6xl w-full mx-auto h-full overflow-y-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Platform Overview</h1>
                    <p className="text-gray-600">Manage vector contexts and execution engines</p>
                </div>
                <Link
                    to="/project/new"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg shadow-md transition-colors text-sm"
                >
                    <Plus size={18} /> Add Project
                </Link>
            </div>

            {loading
                ? <div className="text-gray-500 animate-pulse">Scanning infrastructure...</div>
                : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm shadow-gray-200/50">
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                                <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                                    <Folder className="text-orange-500" /> Projects Matrix
                                </h2>
                            </div>
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                                {projects.length === 0
                                    ? (
                                        <p className="text-gray-500 text-sm">
                                            Empty vector store. Ingest documentation to begin.
                                        </p>
                                    )
                                    : null}
                                {projects.map((p: any) => (
                                    <div
                                        key={p.id}
                                        className="flex flex-col p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors group"
                                    >
                                        <div className="flex justify-between items-start">
                                            <span className="font-semibold text-gray-900 group-hover:text-orange-500 transition-colors">
                                                {p.projectName}
                                            </span>
                                            <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                {p.id}
                                            </span>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            <span className="text-xs bg-orange-50 text-orange-500 px-2 py-1 rounded flex items-center gap-1">
                                                <Folder size={12} /> {p.files?.length || 0} Files
                                            </span>
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                Vectors Ingested
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm shadow-gray-200/50">
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                                <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                                    <FileCode2 className="text-orange-600" /> Test Suites Hub
                                </h2>
                                <Link
                                    to="/testsuite/new"
                                    className="text-sm text-orange-600 hover:text-orange-700 font-medium"
                                >
                                    Deploy New
                                </Link>
                            </div>
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                                {testSuites.length === 0
                                    ? (
                                        <p className="text-gray-500 text-sm">
                                            No agentic tests tracked.
                                        </p>
                                    )
                                    : null}
                                {testSuites.map((ts: any) => (
                                    <div
                                        key={ts.id}
                                        className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
                                    >
                                        <div className="flex-1">
                                            <span className="font-semibold text-gray-900 block mb-1">
                                                {ts.userGoal || "Autonomous API Scenario"}
                                            </span>
                                            <div className="flex items-center gap-2 text-xs text-gray-600 mt-2">
                                                <span className="bg-orange-50 text-orange-600 px-2 py-1 rounded font-mono">
                                                    {ts.mode}
                                                </span>
                                                <span
                                                    className="truncate max-w-[120px] font-mono text-[10px]"
                                                    title={ts.projectId}
                                                >
                                                    {ts.projectId}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-center border-l border-gray-200 pl-4">
                                            <Link
                                                to={`/execute/${ts.id}`}
                                                className="w-10 h-10 flex items-center justify-center bg-orange-500/20 text-orange-500 hover:bg-orange-500 hover:text-white rounded-full transition-all"
                                                title="Launch Execution Stream"
                                            >
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
