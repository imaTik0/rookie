import { useState, useMemo } from 'react';
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Loader, Copy, FileText, ChevronDown, ChevronUp, Activity, FileCode, Check, X } from 'lucide-react';
import { marked } from 'marked';

const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMemo(() => {
    try {
      return marked.parse(content);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div 
      className="prose prose-sm max-w-full text-slate-300 prose-headings:text-white prose-a:text-blue-400 prose-code:text-purple-400 prose-code:bg-slate-800 prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800" 
      dangerouslySetInnerHTML={{ __html: html as string }} 
    />
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, any> = {
    SUCCESS: { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-400", icon: <CheckCircle size={14} className="mr-1.5" /> },
    FAILED: { bg: "bg-rose-500/20", border: "border-rose-500/30", text: "text-rose-400", icon: <XCircle size={14} className="mr-1.5" /> },
    PARTIAL_FAILURE: { bg: "bg-amber-500/20", border: "border-amber-500/30", text: "text-amber-400", icon: <AlertTriangle size={14} className="mr-1.5" /> },
    RUNNING: { bg: "bg-blue-500/20", border: "border-blue-500/30", text: "text-blue-400", icon: <Loader size={14} className="mr-1.5 animate-spin" /> }
  };
  const current = config[status] || config.RUNNING;

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${current.bg} ${current.border} ${current.text}`}>
      {current.icon}
      {status}
    </span>
  );
};

const CodeBlock = ({ code, language = "javascript" }: { code: string, language?: string }) => (
  <div className="bg-[#0d1117] rounded-xl overflow-hidden border border-slate-800 shadow-inner">
    <div className="bg-slate-900/80 px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{language}</span>
      <button 
        onClick={() => navigator.clipboard.writeText(code)}
        className="text-slate-500 hover:text-white transition-colors"
        title="Copy"
      >
        <Copy size={14} />
      </button>
    </div>
    <pre className="p-4 text-xs text-emerald-400 font-mono overflow-x-auto max-h-96">
      <code>{code}</code>
    </pre>
  </div>
);

const RelatedKnowledgeItem = ({ item }: { item: any }) => {
  const payload = item.payload || item;
  const content = payload.content;
  const metadata = payload.metadata || {};
  const score = item.score;

  if (!content) {
    return (
      <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
        <pre className="text-xs text-amber-500/80 whitespace-pre-wrap font-mono overflow-x-auto">
          {JSON.stringify(item, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md mb-4">
      <div className="bg-slate-800/50 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-200">
            {metadata.fileName || "Knowledge Base Match"}
          </span>
        </div>
        <span className="text-xs text-slate-500 font-mono bg-slate-950 px-2 py-1 rounded">
          Score: {typeof score === "number" ? score.toFixed(4) : "N/A"}
        </span>
      </div>
      <div className="p-5 bg-slate-900/50">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
};

const StepDetail = ({ step }: { step: any }) => {
  const [isOpen, setIsOpen] = useState(step.status === "FAILED");
  const [activeTab, setActiveTab] = useState("logs"); 

  const relatedItems = useMemo(() => {
    if (!step.relatedKnowledge) return [];
    if (Array.isArray(step.relatedKnowledge)) return step.relatedKnowledge;
    if (step.relatedKnowledge.points && Array.isArray(step.relatedKnowledge.points)) {
      return step.relatedKnowledge.points;
    }
    return [];
  }, [step.relatedKnowledge]);

  const hasRelated = relatedItems.length > 0;
  const isFailed = step.status === "FAILED";

  return (
    <div className={`rounded-xl mb-4 bg-slate-900 shadow-lg overflow-hidden border ${isFailed ? "border-rose-500/30 shadow-rose-900/10" : "border-slate-800"}`}>
      <div 
        className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-xl ${isFailed ? "bg-rose-500/20 text-rose-400 shadow-inner shadow-rose-500/20" : "bg-emerald-500/20 text-emerald-400 shadow-inner shadow-emerald-500/20"}`}>
            {isFailed ? <X size={20} className="stroke-[3px]" /> : <Check size={20} className="stroke-[3px]" />}
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Step {step.stepIndex}</h3>
            <p className="text-sm text-slate-400 mt-0.5">{step.stepDescription}</p>
          </div>
        </div>
        {isOpen ? <ChevronUp className="text-slate-500" /> : <ChevronDown className="text-slate-500" />}
      </div>

      {isOpen && (
        <div className="border-t border-slate-800 bg-slate-950">
          <div className="flex border-b border-slate-800 px-2 pt-2">
            {["logs", "script", "context", "related"].map(tab => {
              if (tab === "related" && !hasRelated) return null;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2.5 text-sm font-medium transition-all rounded-t-lg mx-1 ${
                    activeTab === tab 
                      ? "bg-slate-800 text-white shadow-sm" 
                      : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              );
            })}
          </div>

          <div className="p-6">
            {activeTab === "logs" && (
              <div className="space-y-4">
                {step.error && (
                  <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl p-4 shadow-inner">
                    <pre className="text-rose-400/90 text-xs font-mono whitespace-pre-wrap">{step.error}</pre>
                  </div>
                )}
                <CodeBlock code={step.logs || "No logs captured."} language="bash" />
              </div>
            )}
            {activeTab === "script" && <CodeBlock code={step.scriptContent} />}
            {activeTab === "context" && (
              <div className="bg-[#0d1117] rounded-xl border border-slate-800 p-4 shadow-inner">
                <pre className="text-xs text-blue-300 font-mono overflow-auto max-h-96">
                  {JSON.stringify(step.contextAfter, null, 2)}
                </pre>
              </div>
            )}
            {activeTab === "related" && (
              <div className="space-y-4">
                {relatedItems.map((item: any, idx: number) => <RelatedKnowledgeItem key={idx} item={item} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default function ReportViewer({ report, onBack }: { report: any, onBack: () => void }) {
  const steps = report.detailedResults?.steps || report.steps || [];
  const isCodeGeneration = report.type === "CODE_GENERATION";
  
  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] overflow-y-auto">
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <button 
              onClick={onBack} 
              className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-full transition-colors text-slate-300"
              title="Back to Stream"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Activity className="text-blue-500" size={20} />
                {isCodeGeneration ? "Code Generation Report" : "Test Execution Report"}
              </h1>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                Suite: <span className="text-slate-300">{report.testSuiteId}</span> • {new Date(report.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
          <StatusBadge status={report.status} />
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-6 py-10 space-y-10">
        {isCodeGeneration && report.detailedResults?.finalOutput && (
          <div className="bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-800">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3 border-b border-slate-800 pb-4">
              <FileCode className="text-purple-400" /> Generated Deliverables
            </h2>
            <MarkdownRenderer content={report.detailedResults.finalOutput} />
          </div>
        )}

        <div>
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3 border-b border-slate-800 pb-4">
            <Activity className="text-blue-400" /> Execution Diagnostics & Validation
          </h2>
          <div className="space-y-4">
            {steps.length === 0 && <p className="text-slate-500 italic">No execution steps found in this report.</p>}
            {steps.map((step: any) => <StepDetail key={step.stepIndex} step={step} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
