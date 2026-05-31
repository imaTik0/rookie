import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Code, Beaker } from "lucide-react";

export default function TestSuiteCreator() {
    const [projects, setProjects] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        projectId: "",
        userGoal: "",
        mode: "CODE_GENERATION",
        initialContext: "{\n  \"example\": \"value\"\n}",
        minimalStoryLength: 2,
        maximalStoryLength: 5,
    });
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        fetch("http://localhost:3000/projects")
            .then((r) => r.json())
            .then((data) => {
                setProjects(data.projects || []);
                if (data.projects?.length > 0) {
                    setFormData((prev) => ({ ...prev, projectId: data.projects[0].id }));
                }
            });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch("http://localhost:3000/testsuites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    functionTemplate: "export default async (ctx) => { /* TEMPLATE */ }",
                }),
            });
            if (res.ok) {
                const ts = await res.json();
                navigate(`/execute/${ts.id}`);
            } else {
                alert("Failed to create test suite");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto animate-enter flex items-center justify-center min-h-full">
            <div className="w-full max-w-2xl px-8 py-12">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Configure Protocol
                    </h1>
                    <p className="text-gray-400 text-sm">Design agentic RAG generation parameters.</p>
                </div>

                <div className="glass-panel rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                                    Project Vector
                                </label>
                                <select
                                    value={formData.projectId}
                                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                                    className="w-full px-4 py-3.5 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white focus:border-gray-500/50 focus:bg-[#151517]/60 outline-none transition-all appearance-none"
                                >
                                    {projects.map((p) => (
                                        <option key={p.id} value={p.id}>{p.projectName}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                                    Operation Mode
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, mode: "CODE_GENERATION" })}
                                        className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl text-xs font-semibold transition-all ${
                                            formData.mode === "CODE_GENERATION"
                                                ? "bg-gray-500 text-white shadow-lg shadow-gray-500/20"
                                                : "bg-[#151517]/40 text-gray-400 border border-white/5 hover:bg-white/5 hover:text-white"
                                        }`}
                                    >
                                        <Code size={14} /> Code
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, mode: "TEST_SCENARIO" })}
                                        className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl text-xs font-semibold transition-all ${
                                            formData.mode === "TEST_SCENARIO"
                                                ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                                                : "bg-[#151517]/40 text-gray-400 border border-white/5 hover:bg-white/5 hover:text-white"
                                        }`}
                                    >
                                        <Beaker size={14} /> Test
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                                Primary Objective
                            </label>
                            <input
                                required
                                type="text"
                                value={formData.userGoal}
                                onChange={(e) => setFormData({ ...formData, userGoal: e.target.value })}
                                placeholder="Describe what the agent should try to accomplish..."
                                className="w-full px-4 py-3.5 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:border-gray-500/50 focus:bg-[#151517]/60 outline-none transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2 flex items-center justify-between">
                                Initial Environment State
                                <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-gray-500 font-mono">JSON</span>
                            </label>
                            <textarea
                                value={formData.initialContext}
                                onChange={(e) => setFormData({ ...formData, initialContext: e.target.value })}
                                className="w-full px-4 py-3.5 bg-[#151517]/60 border border-white/10 rounded-xl text-sm text-green-400 font-mono h-28 focus:border-gray-500/50 outline-none transition-all"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !formData.projectId}
                            className="w-full py-4 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5 active:scale-[0.98]"
                        >
                            {loading ? (
                                "Initializing..."
                            ) : (
                                <>
                                    Launch Protocol <Play size={16} className="fill-black" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
