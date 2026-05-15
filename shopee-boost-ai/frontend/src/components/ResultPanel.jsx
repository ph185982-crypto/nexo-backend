import { useState } from 'react';
import ImageGrid from './ImageGrid.jsx';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button onClick={handleCopy} className="copy-btn">
      {copied ? (
        <>
          <span>✅</span>
          Copiado!
        </>
      ) : (
        <>
          <span>📋</span>
          Copiar
        </>
      )}
    </button>
  );
}

export default function ResultPanel({ result }) {
  const { optimizedTitle, optimizedDescription, productCategory, keywords, images } = result;

  return (
    <div className="space-y-5">
      {/* Success banner */}
      <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-medium">
        <span className="text-lg">🎉</span>
        Assets gerados com sucesso! Copie ou baixe abaixo.
      </div>

      {/* Category + Keywords */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-gray-500 font-medium">Categoria:</span>
          <span className="bg-shopee-500/10 text-shopee-400 border border-shopee-500/30 text-xs font-semibold px-2.5 py-1 rounded-full">
            {productCategory}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-500 font-medium mr-1">Keywords SEO:</span>
          {keywords.map((kw, i) => (
            <span
              key={i}
              className="bg-dark-700 border border-dark-500 text-gray-300 text-xs px-2.5 py-1 rounded-full"
            >
              {kw}
            </span>
          ))}
        </div>
      </div>

      {/* Optimized Title */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📝</span> Título Otimizado
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {optimizedTitle.length}/120 chars
            </span>
            <CopyButton text={optimizedTitle} />
          </div>
        </div>
        <p className="text-white text-sm leading-relaxed bg-dark-700 rounded-xl px-4 py-3 border border-dark-500">
          {optimizedTitle}
        </p>
      </div>

      {/* Optimized Description */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📄</span> Descrição Otimizada
          </h3>
          <CopyButton text={optimizedDescription} />
        </div>
        <div className="bg-dark-700 rounded-xl px-4 py-3 border border-dark-500 max-h-72 overflow-y-auto">
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
            {optimizedDescription}
          </p>
        </div>
        <p className="mt-2 text-xs text-gray-600 text-right">
          {optimizedDescription.split(/\s+/).length} palavras
        </p>
      </div>

      {/* Image Grid */}
      <div className="card">
        <ImageGrid images={images} productTitle={optimizedTitle} />
      </div>
    </div>
  );
}
