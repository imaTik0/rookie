import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, HardDrive, Loader2, Link } from 'lucide-react';

export default function ProjectCreator() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3000/projects/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: name, url })
      });
      if (res.ok) {
        navigate('/');
      } else {
        const err = await res.json();
        alert(`Error: ${JSON.stringify(err)}`);
      }
    } catch (err) {
      alert("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-10 max-w-4xl mx-auto w-full flex flex-col h-full overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Ingest Core Documentation</h1>
        <p className="text-gray-600">Provide an online documentation link to be parsed, vector-embedded and mapped to a new Project.</p>
      </div>

      <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-xl w-full max-w-2xl mx-auto mt-6">
        <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-200 text-gray-900">
          <Globe className="text-orange-500" />
          <h2 className="text-xl font-semibold">Web Ingestion Pipeline</h2>
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
                placeholder="https://hono.dev/getting-started/basic"
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-mono text-sm"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">The URL will be parsed by Jina.ai, automatically filtered, and ingested directly into Qdrant vector storage.</p>
          </div>

          <div className="pt-4 border-t border-gray-200 flex justify-end">
            <button 
              type="submit" 
              disabled={loading || !name || !url}
              className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors shadow-lg shadow-orange-600/20"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <HardDrive size={18} />}
              {loading ? 'Initializing Agent Vectors...' : 'Scrape & Initialize Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
