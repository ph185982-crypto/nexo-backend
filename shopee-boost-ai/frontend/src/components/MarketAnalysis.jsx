import { useState } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CATEGORIES = [
  { label: 'Todas', value: '' },
  { label: 'Eletrônicos', value: 'Eletrônicos' },
  { label: 'Moda Feminina', value: 'Moda Feminina' },
  { label: 'Moda Masculina', value: 'Moda Masculina' },
  { label: 'Casa e Decoração', value: 'Casa e Decoração' },
  { label: 'Beleza', value: 'Beleza' },
  { label: 'Ferramentas', value: 'Ferramentas' },
  { label: 'Calçados', value: 'Calçados' },
  { label: 'Esporte', value: 'Esporte' },
  { label: 'Pets', value: 'Pets' },
  { label: 'Bebês', value: 'Bebês' },
  { label: 'Automotivo', value: 'Automotivo' },
  { label: 'Games', value: 'Games' },
  { label: 'Alimentos', value: 'Alimentos' },
];

function VolumeBadge({ volume }) {
  const styles = {
    Alto: 'bg-green-500/20 text-green-400 border-green-500/30',
    Médio: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    Baixo: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[volume] || styles['Baixo']}`}>
      {volume}
    </span>
  );
}

function CompetitionBadge({ competition }) {
  const styles = {
    Alta: 'bg-red-500/20 text-red-400 border-red-500/30',
    Média: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    Baixa: 'bg-green-500/20 text-green-400 border-green-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[competition] || styles['Média']}`}>
      {competition}
    </span>
  );
}

function TrendIcon({ trend }) {
  if (trend === 'up') {
    return <span className="text-green-400 font-bold text-base" title="Em alta">↑</span>;
  }
  if (trend === 'down') {
    return <span className="text-red-400 font-bold text-base" title="Em baixa">↓</span>;
  }
  return <span className="text-gray-500 font-bold text-base" title="Estável">→</span>;
}

function KeywordCard({ item }) {
  return (
    <div className="bg-dark-700 border border-dark-500 rounded-xl p-4 flex flex-col gap-3 hover:border-dark-400 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-white font-semibold text-sm leading-tight flex-1">{item.keyword}</p>
        <TrendIcon trend={item.trend} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Volume:</span>
        <VolumeBadge volume={item.volume} />
        <span className="text-xs text-gray-500 ml-1">Concorrência:</span>
        <CompetitionBadge competition={item.competition} />
      </div>

      {item.insight && (
        <p className="text-xs text-gray-400 leading-relaxed border-t border-dark-500 pt-2">{item.insight}</p>
      )}

      <a
        href={item.shopeeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-flex items-center justify-center gap-1.5 bg-dark-600 hover:bg-shopee-500 text-gray-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-all duration-200"
      >
        🔍 Buscar na Shopee
      </a>
    </div>
  );
}

function ProductCard({ product }) {
  return (
    <div className="bg-dark-700 border border-dark-500 rounded-xl p-5 flex flex-col gap-3 hover:border-dark-400 transition-colors">
      <h3 className="text-white font-bold text-base leading-tight">{product.title}</h3>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-shopee-400 font-semibold text-sm">{product.priceRange}</span>
        <span className="text-gray-500 text-xs">{product.monthlySales}</span>
      </div>

      {product.opportunity && (
        <p className="text-gray-400 text-xs italic leading-relaxed">{product.opportunity}</p>
      )}

      {Array.isArray(product.differentials) && product.differentials.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-500 font-medium">Diferenciais:</span>
          <div className="flex flex-wrap gap-1.5">
            {product.differentials.map((d, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/25"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      <a
        href={product.shopeeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-flex items-center justify-center gap-1.5 btn-primary text-sm py-2.5"
      >
        🛍️ Ver na Shopee
      </a>
    </div>
  );
}

function InsightCard({ text, index }) {
  return (
    <div className="bg-dark-700 border border-dark-500 rounded-xl px-4 py-3.5 flex items-start gap-3 hover:border-dark-400 transition-colors">
      <span className="text-xl flex-shrink-0 mt-0.5">💡</span>
      <p className="text-gray-200 text-sm leading-relaxed">{text}</p>
    </div>
  );
}

export default function MarketAnalysis() {
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleAnalyze() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await axios.post(
        `${API_URL}/api/market-analysis`,
        { category, keyword },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );
      setResult(response.data);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('A análise demorou mais que o esperado. Tente novamente.');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Erro ao conectar com o servidor. Verifique sua conexão.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError('');
    setCategory('');
    setKeyword('');
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Search panel */}
      {!result && (
        <div className="max-w-3xl mx-auto animate-fade-in">
          <div className="card space-y-6">
            {/* Header */}
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Análise de Mercado IA</h2>
              <p className="text-sm text-gray-500">
                Descubra tendências reais, palavras-chave e produtos que mais vendem no Shopee Brasil — gerado por GPT-4o.
              </p>
            </div>

            {/* Category pills */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                🏷️ Categoria
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer border transition-all duration-150 ${
                      category === cat.value
                        ? 'bg-shopee-500 border-shopee-500 text-white'
                        : 'bg-dark-700 border-dark-500 text-gray-300 hover:border-shopee-500/60 hover:text-white'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Keyword input */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🔍 Produto ou palavra-chave <span className="text-gray-600 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && handleAnalyze()}
                placeholder="Ex: fone bluetooth, tênis nike, panela..."
                className="input-field text-sm"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl flex items-start gap-3">
                <span className="text-lg flex-shrink-0">⚠️</span>
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* Analyze button */}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="btn-primary w-full text-base flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analisando tendências do Shopee Brasil...
                </>
              ) : (
                <>
                  <span>📊</span>
                  Analisar Mercado
                </>
              )}
            </button>

            {/* Info note */}
            <p className="text-center text-xs text-gray-600">
              Análise IA — baseada em conhecimento real do Shopee Brasil via GPT-4o
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-8 animate-slide-up">
          {/* Results header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">
                Análise de Mercado
                {result.category && (
                  <span className="ml-2 text-shopee-400">— {result.category}</span>
                )}
                {result.keyword && (
                  <span className="ml-2 text-gray-400 font-normal text-base">"{result.keyword}"</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Gerado por IA em {new Date(result.searchedAt).toLocaleString('pt-BR')} · Análise IA
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 bg-dark-700 hover:bg-dark-600 border border-dark-500 text-gray-300 hover:text-white text-sm font-medium px-4 py-2 rounded-xl transition-all duration-200 flex-shrink-0"
            >
              ← Analisar outra categoria
            </button>
          </div>

          {/* Section: Trending Keywords */}
          {result.trendingKeywords?.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🔥</span>
                <h3 className="text-lg font-bold text-white">Palavras-chave em Alta</h3>
                <span className="bg-dark-600 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                  {result.trendingKeywords.length} termos
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {result.trendingKeywords.map((kw, i) => (
                  <KeywordCard key={i} item={kw} />
                ))}
              </div>
            </section>
          )}

          {/* Section: Top Products */}
          {result.topProducts?.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🏆</span>
                <h3 className="text-lg font-bold text-white">Produtos Mais Vendidos</h3>
                <span className="bg-dark-600 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                  {result.topProducts.length} produtos
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.topProducts.map((product, i) => (
                  <ProductCard key={i} product={product} />
                ))}
              </div>
            </section>
          )}

          {/* Section: Insights */}
          {result.insights?.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">💡</span>
                <h3 className="text-lg font-bold text-white">Insights Estratégicos</h3>
              </div>
              <div className="flex flex-col gap-3">
                {result.insights.map((insight, i) => (
                  <InsightCard key={i} text={insight} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* Bottom reset */}
          <div className="pt-2 pb-4 flex justify-center">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 bg-dark-700 hover:bg-dark-600 border border-dark-500 text-gray-300 hover:text-white text-sm font-medium px-6 py-3 rounded-xl transition-all duration-200"
            >
              📊 Analisar outra categoria
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
