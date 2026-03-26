import React from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { FileText, LayoutDashboard, Play, PlusCircle } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import ProjectCreator from "./pages/ProjectCreator";
import TestSuiteCreator from "./pages/TestSuiteCreator";
import ExecutionConsole from "./pages/ExecutionConsole";
import Reports from "./pages/Reports";

export default function App() {
    const location = useLocation();

    const navItem = (path: string, icon: React.ReactNode, label: string) => {
        const isActive = location.pathname === path ||
            (path === "/execute" && location.pathname.startsWith("/execute"));
        return (
            <Link
                to={path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${isActive
                        ? "bg-orange-500 text-white font-medium"
                        : "text-gray-600 hover:text-orange-600 hover:bg-orange-50"
                    }`}
            >
                {icon} {label}
            </Link>
        );
    };

    return (
        <div className="flex h-screen bg-white text-gray-900 font-sans">
            <aside className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col z-10">
                <div className="p-6 border-b border-gray-200">
                    <h1 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                        <img
                            src="/rookielogo.png"
                            alt="Rookie Logo"
                            className="w-8 h-8 object-contain"
                        />
                        Rookie
                    </h1>
                </div>
                <nav className="flex-1 p-4 space-y-1.5">
                    {navItem("/", <LayoutDashboard size={18} />, "Dashboard")}
                    {navItem("/project/new", <PlusCircle size={18} />, "New Project")}
                    {navItem("/testsuite/new", <PlusCircle size={18} />, "New Test Suite")}
                    {navItem("/execute", <Play size={18} />, "Execute Tests")}
                    {navItem("/reports", <FileText size={18} />, "Reports")}
                </nav>
            </aside>
            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-white relative">
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/project/new" element={<ProjectCreator />} />
                    <Route path="/testsuite/new" element={<TestSuiteCreator />} />
                    <Route path="/execute" element={<ExecutionConsole />} />
                    <Route path="/execute/:id" element={<ExecutionConsole />} />
                    <Route path="/reports" element={<Reports />} />
                </Routes>
            </main>
        </div>
    );
}
