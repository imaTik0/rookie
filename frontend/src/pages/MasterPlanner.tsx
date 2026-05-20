import { useEffect, useState } from "react";
import { BrainCircuit, Play } from "lucide-react";
import { marked } from "marked";

export default function MasterPlanner() {
    const [projects, setProjects] = useState<{ id: string; projectName: string }[]>([]);
    const [projectId, setProjectId] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ goals: string[]; finalSummary: string } | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch("http://localhost:3000/projects")
            .then((res) => res.json())
            .then((data) => {
                setProjects(data.projects || []);
                if (data.projects?.length > 0) {
                    setProjectId(data.projects[0].id);
                }
            });
    }, []);

    const handleRunMasterPlan = async () => {
        setLoading(true);
        setError("");
        setResult(null);

        try {
            const res = await fetch("http://localhost:3000/planner/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId }),
            });
            if (res.ok) {
                const data = await res.json();
                setResult(data);
            } else {
                const errData = await res.json();
                setError(errData.message || "Failed to run Master Plan");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unknown error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-10 max-w-5xl mx-auto w-full h-full overflow-y-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Master Planner</h1>
                <p className="text-gray-600">
                    Analyze the entire project documentation and generate a suite of real-world use cases automatically.
                </p>
            </div>

            <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-xl mt-6">
                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-200 text-gray-900">
                    <BrainCircuit className="text-orange-600" />
                    <h2 className="text-xl font-semibold">Configuration</h2>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Target Project Vector
                        </label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:border-orange-500 outline-none"
                            disabled={loading}
                        >
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>{p.projectName}</option>
                            ))}
                        </select>
                    </div>

                    <div className="pt-4 border-t border-gray-200 flex justify-end">
                        <button
                            onClick={handleRunMasterPlan}
                            disabled={loading || !projectId}
                            className="flex items-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-medium rounded-xl shadow-lg transition-colors"
                        >
                            <Play size={18} />
                            {loading ? "Analyzing & Testing..." : "Run Master Plan"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200">
                        {error}
                    </div>
                )}
            </div>

            {result && (
                <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-xl mt-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6 pb-4 border-b border-gray-200">
                        Master Plan Results
                    </h2>
                    
                    <div className="mb-8">
                        <h3 className="text-lg font-semibold text-gray-800 mb-3">Generated User Goals</h3>
                        <ul className="list-disc pl-5 space-y-1 text-gray-600">
                            {result.goals.map((goal: string, idx: number) => (
                                <li key={idx}>{goal}</li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h3 className="text-lg font-semibold text-gray-800 mb-3">Final Execution Summary</h3>
                        <div 
                            className="prose prose-orange max-w-none text-gray-700"
                            dangerouslySetInnerHTML={{ __html: marked.parse(result.finalSummary) as string }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
