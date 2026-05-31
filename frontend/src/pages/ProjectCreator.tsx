import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight, Link as LinkIcon, Hash } from "lucide-react";

export default function ProjectCreator() {
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [maxPages, setMaxPages] = useState(50);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState("");
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus("Crawling documentation...");

        try {
            const res = await fetch("http://localhost:3000/projects/from-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectName: name, url, maxPages }),
            });
            if (res.ok) {
                setStatus("Done. Initializing...");
                setTimeout(() => navigate("/"), 800);
            } else {
                const err = await res.json();
                setStatus(`Error: ${err.message || JSON.stringify(err)}`);
            }
        } catch {
            setStatus("Connection failed. Check backend status.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto animate-enter flex items-center justify-center min-h-full">
            <div className="w-full max-w-xl px-8 py-12">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Initialize Project Vector
                    </h1>
                    <p className="text-gray-400 text-sm">Target a documentation source to create a new agentic knowledge base.</p>
                </div>

                <div className="glass-panel rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute -top-32 -right-32 w-64 h-64 bg-gray-500/10 blur-[100px] rounded-full pointer-events-none" />
                    <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />

                    <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                        <div>
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                                Project Designation
                            </label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                                    <Hash size={16} />
                                </div>
                                <input
                                    required
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Hono Framework Core"
                                    className="w-full pl-11 pr-4 py-3.5 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:border-gray-500/50 focus:bg-[#151517]/60 focus:ring-1 focus:ring-gray-500/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                                Target URL
                            </label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                                    <LinkIcon size={16} />
                                </div>
                                <input
                                    required
                                    type="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="https://hono.dev/docs"
                                    className="w-full pl-11 pr-4 py-3.5 bg-[#151517]/40 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:border-gray-500/50 focus:bg-[#151517]/60 focus:ring-1 focus:ring-gray-500/50 transition-all outline-none font-mono"
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-semibold">
                                    Depth Limit (Pages)
                                </label>
                                <span className="text-xs text-gray-500 font-mono font-bold bg-gray-500/10 px-2 py-0.5 rounded">{maxPages}</span>
                            </div>
                            <input
                                type="range"
                                min={1}
                                max={200}
                                value={maxPages}
                                onChange={(e) => setMaxPages(Number(e.target.value))}
                                className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-gray-500"
                            />
                            <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-2">
                                <span>1</span><span>100</span><span>200</span>
                            </div>
                        </div>

                        {status && (
                            <div className={`px-4 py-3 rounded-xl text-xs font-mono flex items-center gap-3 animate-enter border ${
                                status.startsWith("Error")
                                    ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                                    : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                            }`}>
                                {loading && <Loader2 size={14} className="animate-spin shrink-0" />}
                                {status}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !name || !url}
                            className="w-full py-4 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-white transition-all flex items-center justify-center gap-2 group mt-4 shadow-lg shadow-white/5 hover:shadow-white/10 active:scale-[0.98]"
                        >
                            {loading ? "Indexing Sequence Initiated" : "Establish Vector Database"}
                            {!loading && <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
