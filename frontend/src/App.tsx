import React from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { FileText, LayoutDashboard, Play, Plus, BrainCircuit, BarChart3, Hexagon } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import ProjectCreator from "./pages/ProjectCreator";
import TestSuiteCreator from "./pages/TestSuiteCreator";
import ExecutionConsole from "./pages/ExecutionConsole";
import Reports from "./pages/Reports";
import MasterPlanner from "./pages/MasterPlanner";

const NAV = [
    { path: "/", icon: LayoutDashboard, label: "Overview" },
    { path: "/planner", icon: BrainCircuit, label: "Planner" },
    { path: "/execute", icon: Play, label: "Execute", prefix: true },
    { path: "/project/new", icon: Plus, label: "New Project" },
    { path: "/testsuite/new", icon: BarChart3, label: "New Suite" },
    { path: "/reports", icon: FileText, label: "Reports" },
];

export default function App() {
    const location = useLocation();

    return (
        <div className="flex h-screen overflow-hidden text-gray-100 font-sans">
            {/* Sidebar */}
            <aside className="w-64 flex flex-col shrink-0 border-r border-white/5 bg-[#151517]/20 backdrop-blur-3xl relative z-10">
                <div className="h-16 flex items-center px-6 border-b border-white/5 gap-3">
                    <div className="p-1.5 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg shadow-lg shadow-gray-500/20">
                        <Hexagon size={16} className="text-white" />
                    </div>
                    <span className="text-[13px] font-bold tracking-[0.2em] uppercase bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Rookie
                    </span>
                </div>

                <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
                    {NAV.map(({ path, icon: Icon, label, prefix }) => {
                        const isActive = prefix
                            ? location.pathname.startsWith(path)
                            : location.pathname === path;
                        return (
                            <Link
                                key={path}
                                to={path}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-300 group ${
                                    isActive
                                        ? "bg-white/10 text-white shadow-inner shadow-white/5"
                                        : "text-gray-400 hover:text-white hover:bg-white/5"
                                }`}
                            >
                                <Icon size={16} className={`transition-transform duration-300 ${isActive ? "" : "group-hover:scale-110"}`} />
                                {label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="px-6 py-5 border-t border-white/5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                            <span className="text-xs text-gray-400 font-mono">System Online</span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">v1.0.0</span>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/project/new" element={<ProjectCreator />} />
                    <Route path="/testsuite/new" element={<TestSuiteCreator />} />
                    <Route path="/planner" element={<MasterPlanner />} />
                    <Route path="/execute" element={<ExecutionConsole />} />
                    <Route path="/execute/:id" element={<ExecutionConsole />} />
                    <Route path="/reports" element={<Reports />} />
                </Routes>
            </main>
        </div>
    );
}
