import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const IMAGE_LABELS = [
  { label: 'Principal', emoji: '⭐', desc: 'Fundo branco, estilo e-commerce' },
  { label: 'Lifestyle', emoji: '🌟', desc: 'Uso real / contexto de vida' },
  { label: 'Detalhes', emoji: '🔍', desc: 'Close-up e diferenciais' },
  { label: 'Benefícios', emoji: '✅', desc: 'Layout visual de vantagens' },
  { label: 'Destaque', emoji: '🔥', desc: 'Fundo colorido Shopee style' },
  { label: 'Embalagem', emoji: '📦', desc: 'Packaging e entrega' },
];

async function downloadSingleImage(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    saveAs(blob, filename);
  } catch {
    // Fallback — open in new tab if fetch fails (CORS)
    window.open(url, '_blank');
  }
}

export default function ImageGrid({ images, productTitle }) {
  const [downloading, setDownloading] = useState(false);
  const [loadedImages, setLoadedImages] = useState({});

  async function downloadAllAsZip() {
    setDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('shopee-boost-assets');

      await Promise.all(
        images.map(async (url, i) => {
          const response = await fetch(url);
          const blob = await response.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          folder.file(`${i + 1}-${IMAGE_LABELS[i].label.toLowerCase()}.${ext}`, blob);
        })
      );

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const safeName = (productTitle || 'produto').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
      saveAs(zipBlob, `shopee-boost-${safeName}.zip`);
    } catch (err) {
      alert('Erro ao gerar ZIP. Tente baixar as imagens individualmente.');
    } finally {
      setDownloading(false);
    }
  }

  function handleImageLoad(i) {
    setLoadedImages((prev) => ({ ...prev, [i]: true }));
  }

  return (
    <div>
      {/* Header with download all button */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-white">
          🎨 6 Imagens Geradas
        </h3>
        <button
          onClick={downloadAllAsZip}
          disabled={downloading}
          className="copy-btn text-sm px-4 py-2 bg-shopee-500/10 border border-shopee-500/30 text-shopee-400 hover:bg-shopee-500/20 rounded-xl"
        >
          {downloading ? (
            <>
              <span className="w-3 h-3 border border-shopee-400/30 border-t-shopee-400 rounded-full animate-spin" />
              Comprimindo...
            </>
          ) : (
            <>
              <span>⬇️</span>
              Baixar Todas (ZIP)
            </>
          )}
        </button>
      </div>

      {/* 2x3 grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {images.map((url, i) => {
          const meta = IMAGE_LABELS[i];
          return (
            <div
              key={i}
              className="relative group bg-dark-700 rounded-xl overflow-hidden border border-dark-600 hover:border-shopee-500/40 transition-colors"
            >
              {/* Skeleton while loading */}
              {!loadedImages[i] && (
                <div className="absolute inset-0 shimmer z-10" />
              )}

              <img
                src={url}
                alt={`${meta.label} - ${meta.desc}`}
                className={`w-full aspect-square object-cover transition-opacity duration-300 ${
                  loadedImages[i] ? 'opacity-100' : 'opacity-0'
                }`}
                onLoad={() => handleImageLoad(i)}
              />

              {/* Label */}
              <div className="absolute top-2 left-2 bg-dark-900/80 backdrop-blur-sm text-xs font-semibold text-white px-2 py-1 rounded-lg flex items-center gap-1">
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
              </div>

              {/* Download button (appears on hover) */}
              <div className="absolute inset-0 bg-dark-900/0 group-hover:bg-dark-900/50 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                <button
                  onClick={() => downloadSingleImage(url, `${i + 1}-${meta.label.toLowerCase()}.jpg`)}
                  className="bg-shopee-500 hover:bg-shopee-600 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <span>⬇️</span>
                  Baixar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
