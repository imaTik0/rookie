import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Folder, Database, FileCode2, ChevronRight } from "lucide-react";

export default function Dashboard() {
    const [projects, setProjects] = useState<any[]>([]);
    const [testSuites, setTestSuites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch("http://localhost:3000/projects").then((r) => r.json()),
            fetch("http://localhost:3000/testsuites").then((r) => r.json()),
        ])
            .then(([p, ts]) => {
                setProjects(p.projects || []);
                setTestSuites(ts.testSuites || []);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500 font-mono text-sm animate-pulse">
                Initializing System...
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto animate-enter">
            <div className="max-w-5xl mx-auto px-10 py-12">
                {/* Header */}
                <div className="mb-12">
                    <h1 className="text-3xl font-bold tracking-tight mb-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Command Center
                    </h1>
                    <p className="text-gray-400 text-sm">Monitor your agentic test suites and project vectors.</p>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-6 mb-12">
                    {[
                        { label: "Active Projects", value: projects.length, icon: Folder, color: "text-blue-400" },
                        { label: "Test Suites", value: testSuites.length, icon: Database, color: "text-purple-400" },
                        { label: "Indexed Documents", value: projects.reduce((s: number, p: any) => s + (p.files?.length || 0), 0), icon: FileCode2, color: "text-emerald-400" },
                    ].map((s, i) => (
                        <div key={i} className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300">
                            <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                                <s.icon size={48} className={s.color} />
                            </div>
                            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2 font-medium">{s.label}</div>
                            <div className="text-4xl font-bold font-mono text-white">{s.value}</div>
                        </div>
                    ))}
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-2 gap-8">
                    {/* Projects */}
                    <section>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-[12px] uppercase tracking-widest text-gray-400 font-semibold">Project Vectors</h2>
                            <Link to="/project/new" className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1 transition-colors group">
                                Create New <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                        </div>
                        {projects.length === 0 ? (
                            <div className="border border-dashed border-white/10 rounded-2xl p-10 text-center text-gray-500 text-sm font-mono bg-white/[0.01]">
                                No projects indexed
                            </div>
                        ) : (
                            <div className="glass-panel rounded-2xl divide-y divide-white/5 overflow-hidden">
                                {projects.map((p: any) => (
                                    <div key={p.id} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors group">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2.5 rounded-xl bg-white/5 text-gray-400 group-hover:text-white transition-colors">
                                                <Folder size={18} />
                                            </div>
                                            <div>
                                                <div className="text-sm font-semibold text-gray-100 group-hover:text-white transition-colors">{p.projectName}</div>
                                                <div className="text-xs text-gray-500 font-mono mt-1">
                                                    {p.files?.length || 0} documents · {p.id.substring(0, 8)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Test Suites */}
                    <section>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-[12px] uppercase tracking-widest text-gray-400 font-semibold">Recent Test Suites</h2>
                            <Link to="/testsuite/new" className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1 transition-colors group">
                                Create New <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                        </div>
                        {testSuites.length === 0 ? (
                            <div className="border border-dashed border-white/10 rounded-2xl p-10 text-center text-gray-500 text-sm font-mono bg-white/[0.01]">
                                No active test suites
                            </div>
                        ) : (
                            <div className="glass-panel rounded-2xl divide-y divide-white/5 overflow-hidden">
                                {testSuites.slice(0, 5).map((ts: any) => (
                                    <Link key={ts.id} to={`/execute/${ts.id}`} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors group block">
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <div className="p-2.5 rounded-xl bg-white/5 text-gray-400 group-hover:text-gray-400 transition-colors shrink-0">
                                                <Database size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-gray-100 truncate group-hover:text-white transition-colors">{ts.userGoal || "Untitled Protocol"}</div>
                                                <div className="text-[10px] text-gray-500 font-mono mt-1 flex items-center gap-2">
                                                    <span className="uppercase px-1.5 py-0.5 bg-white/5 rounded text-gray-400">{ts.mode.replace("_", " ")}</span>
                                                    <span>{ts.id.substring(0, 8)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="p-2 text-gray-500 group-hover:text-gray-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0">
                                            <ArrowUpRight size={18} />
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
