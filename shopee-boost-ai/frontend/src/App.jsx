import { useState } from 'react';
import axios from 'axios';
import UploadForm from './components/UploadForm.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleGenerate({ image, title, description }) {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('image', image);
      formData.append('title', title);
      formData.append('description', description);

      const response = await axios.post(`${API_URL}/api/generate`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 180000, // 3 minutes — image generation takes time
      });

      setResult(response.data);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('O processo demorou mais que o esperado. Tente novamente.');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.message) {
        setError('Erro ao conectar com o servidor. Verifique sua conexão.');
      } else {
        setError('Ocorreu um erro inesperado. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Header */}
      <header className="border-b border-dark-700 bg-dark-800/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-shopee-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              SB
            </div>
            <span className="font-bold text-white text-lg tracking-tight">
              ShopeeBoost <span className="text-shopee-500">AI</span>
            </span>
          </div>
          <div className="text-xs text-gray-500 hidden sm:block">
            Powered by GPT-4o + DALL-E 3
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-dark-800 to-dark-900 border-b border-dark-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-center">
          <div className="inline-flex items-center gap-2 bg-shopee-500/10 border border-shopee-500/30 text-shopee-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <span>🚀</span> IA para Shopee Brasil
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 leading-tight">
            Crie assets de produto{' '}
            <span className="text-shopee-500">otimizados</span> para a Shopee
          </h1>
          <p className="text-gray-400 text-base sm:text-lg max-w-2xl mx-auto">
            Envie a foto do produto, e a IA gera título SEO, descrição persuasiva e 6 imagens profissionais prontas para publicar.
          </p>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl flex items-start gap-3 animate-fade-in">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-sm">{error}</p>
          </div>
        )}

        <div className={`grid gap-8 ${result ? 'lg:grid-cols-[420px_1fr]' : 'max-w-2xl mx-auto'}`}>
          {/* Left: Form */}
          <div className={result ? '' : 'w-full'}>
            <UploadForm onSubmit={handleGenerate} loading={loading} />
          </div>

          {/* Right: Results */}
          {result && (
            <div className="animate-slide-up">
              <ResultPanel result={result} />
            </div>
          )}
        </div>
      </main>

      {/* Loading overlay */}
      {loading && <LoadingOverlay />}

      {/* Footer */}
      <footer className="mt-16 border-t border-dark-700 py-6 text-center text-gray-600 text-xs">
        ShopeeBoost AI — Gerado com GPT-4o + DALL-E 3. Sua API Key nunca é armazenada.
      </footer>
    </div>
  );
}
