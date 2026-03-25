import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Activity, Play } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ProjectCreator from './pages/ProjectCreator';
import TestSuiteCreator from './pages/TestSuiteCreator';
import ExecutionConsole from './pages/ExecutionConsole';

export default function App() {
  const location = useLocation();

  const navItem = (path: string, icon: React.ReactNode, label: string) => {
    const isActive = location.pathname === path || (path === '/execute' && location.pathname.startsWith('/execute'));
    return (
      <Link
        to={path}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${
          isActive
            ? 'bg-blue-600 text-white font-medium shadow-md shadow-blue-500/20'
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
        }`}
      >
        {icon} {label}
      </Link>
    );
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50 font-sans">
      <aside className="w-64 border-r border-slate-800/60 bg-slate-950 flex flex-col z-10 shadow-xl shadow-black/50">
        <div className="p-6 border-b border-slate-800/60">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Activity className="text-blue-400" />
            Rookie RAG
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-1.5">
          {navItem('/', <LayoutDashboard size={18} />, 'Dashboard')}
          {navItem('/project/new', <PlusCircle size={18} />, 'New Project')}
          {navItem('/testsuite/new', <PlusCircle size={18} />, 'New Test Suite')}
          {navItem('/execute', <Play size={18} />, 'Execute Tests')}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#0a0f1a] relative">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/new" element={<ProjectCreator />} />
          <Route path="/testsuite/new" element={<TestSuiteCreator />} />
          <Route path="/execute" element={<ExecutionConsole />} />
          <Route path="/execute/:id" element={<ExecutionConsole />} />
        </Routes>
      </main>
    </div>
  );
}
