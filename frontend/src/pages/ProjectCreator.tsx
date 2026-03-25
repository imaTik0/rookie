import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, HardDrive, Loader2, Link } from 'lucide-react';

export default function ProjectCreator() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('Starting crawl...');

    try {
      const res = await fetch('http://localhost:3000/projects/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: name, url, maxPages })
      });
      if (res.ok) {
        setStatus('Project created successfully!');
        setTimeout(() => navigate('/'), 1000);
      } else {
        const err = await res.json();
        setStatus(`Error: ${err.message || JSON.stringify(err)}`);
      }
    } catch {
      setStatus("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-10 max-w-4xl mx-auto w-full flex flex-col h-full overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Ingest Core Documentation</h1>
        <p className="text-gray-600">Provide an online documentation link. The crawler will follow internal links and index the entire docs site.</p>
      </div>

      <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-xl w-full max-w-2xl mx-auto mt-6">
        <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-200 text-gray-900">
          <Globe className="text-orange-500" />
          <h2 className="text-xl font-semibold">Web Crawl &amp; Ingestion Pipeline</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Project Name</label>
            <input 
              required
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Hono Fast Router"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-medium"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Documentation URL</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Link className="text-gray-500" size={18} />
              </div>
              <input 
                required
                type="url" 
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://hono.dev/docs"
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-mono text-sm"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">The crawler will start at this URL, follow same-domain links, and index up to the page limit below.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Pages to Crawl <span className="text-gray-400 font-normal">({maxPages})</span>
            </label>
            <input
              type="range"
              min={1}
              max={200}
              value={maxPages}
              onChange={e => setMaxPages(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>1</span>
              <span>50</span>
              <span>100</span>
              <span>200</span>
            </div>
          </div>

          {status && (
            <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
              status.startsWith('Error') 
                ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                : 'bg-orange-50 text-orange-700 border border-orange-200'
            }`}>
              {loading && <Loader2 size={14} className="inline animate-spin mr-2" />}
              {status}
            </div>
          )}

          <div className="pt-4 border-t border-gray-200 flex justify-end">
            <button 
              type="submit" 
              disabled={loading || !name || !url}
              className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors shadow-lg shadow-orange-600/20"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <HardDrive size={18} />}
              {loading ? 'Crawling & Indexing...' : `Crawl & Initialize (up to ${maxPages} pages)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

