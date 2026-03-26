import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileCode2, Play } from "lucide-react";

export default function TestSuiteCreator() {
    const [projects, setProjects] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        projectId: "",
        userGoal: "",
        mode: "CODE_GENERATION",
        initialContext: "{}",
        minimalStoryLength: 2,
        maximalStoryLength: 5,
    });
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        fetch("http://localhost:3000/projects")
            .then((res) => res.json())
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
                const testSuite = await res.json();
                navigate(`/execute/${testSuite.id}`);
            } else {
                alert("Failed to create Test Suite");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-10 max-w-4xl mx-auto w-full h-full overflow-y-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Deploy Test Suite</h1>
                <p className="text-gray-600">
                    Configure parameters for the Agentic RAG logic generation.
                </p>
            </div>

            <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-xl mt-6">
                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-200 text-gray-900">
                    <FileCode2 className="text-orange-600" />
                    <h2 className="text-xl font-semibold">Test Specification</h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Target Project Vector
                            </label>
                            <select
                                value={formData.projectId}
                                onChange={(e) =>
                                    setFormData({ ...formData, projectId: e.target.value })}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:border-orange-500 outline-none"
                            >
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.projectName}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Execution Mode
                            </label>
                            <select
                                value={formData.mode}
                                onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:border-orange-500 outline-none"
                            >
                                <option value="CODE_GENERATION">
                                    Code Generation (Standalone Scripts)
                                </option>
                                <option value="TEST_SCENARIO">
                                    Test Scenario (Sequential Steps)
                                </option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            User Goal / Instruction
                        </label>
                        <input
                            required
                            type="text"
                            value={formData.userGoal}
                            onChange={(e) => setFormData({ ...formData, userGoal: e.target.value })}
                            placeholder="e.g. Test uploading a file via the main HTTP router"
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:border-orange-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Initial Context JSON (Mock State)
                        </label>
                        <textarea
                            value={formData.initialContext}
                            onChange={(e) =>
                                setFormData({ ...formData, initialContext: e.target.value })}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-mono text-sm h-24 focus:border-orange-500 outline-none"
                        />
                    </div>

                    <div className="pt-4 border-t border-gray-200 flex justify-end">
                        <button
                            type="submit"
                            disabled={loading || !formData.projectId}
                            className="flex items-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl shadow-lg transition-colors"
                        >
                            <Play size={18} />
                            {loading ? "Scaffolding..." : "Compile & Go to Execution"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
