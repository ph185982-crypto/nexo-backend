import { useState, useRef, useCallback } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function UploadForm({ onSubmit, loading }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const fileInputRef = useRef(null);

  function validateFile(file) {
    if (!file.type.startsWith('image/')) {
      return 'Apenas imagens são aceitas (JPG, PNG, WEBP, etc.)';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'Imagem muito grande. Use imagens até 10MB.';
    }
    return null;
  }

  function handleFile(file) {
    const err = validateFile(file);
    if (err) {
      setFieldErrors((prev) => ({ ...prev, image: err }));
      return;
    }
    setFieldErrors((prev) => ({ ...prev, image: undefined }));
    setImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  function validate() {
    const errors = {};
    if (!image) errors.image = 'Selecione uma imagem do produto.';
    if (!title.trim()) errors.title = 'Título é obrigatório.';
    if (!description.trim()) errors.description = 'Descrição é obrigatória.';
    return errors;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    onSubmit({ image, title, description });
  }

  function removeImage() {
    setImage(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Dados do Produto</h2>
        <p className="text-xs text-gray-500">Preencha os campos abaixo para gerar seus assets</p>
      </div>

      {/* Image upload */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          📸 Foto do Produto
        </label>
        {preview ? (
          <div className="relative rounded-xl overflow-hidden bg-dark-700 border border-dark-500">
            <img
              src={preview}
              alt="Preview do produto"
              className="w-full h-48 object-contain"
            />
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 right-2 bg-dark-900/80 hover:bg-dark-900 text-gray-300 hover:text-white rounded-lg px-2 py-1 text-xs transition-colors"
            >
              ✕ Remover
            </button>
          </div>
        ) : (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
              ${dragOver
                ? 'border-shopee-500 bg-shopee-500/5'
                : fieldErrors.image
                ? 'border-red-500/50 bg-red-500/5'
                : 'border-dark-500 hover:border-shopee-500/50 hover:bg-dark-700/50'
              }
            `}
          >
            <div className="text-3xl mb-2">📁</div>
            <p className="text-sm text-gray-400 mb-1">
              Arraste a imagem aqui ou <span className="text-shopee-400 font-medium">clique para selecionar</span>
            </p>
            <p className="text-xs text-gray-600">JPG, PNG, WEBP — até 10MB</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
          className="hidden"
        />
        {fieldErrors.image && (
          <p className="mt-1 text-xs text-red-400">{fieldErrors.image}</p>
        )}
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          📝 Título do Produto
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Fone de ouvido Bluetooth sem fio..."
          className={`input-field text-sm ${fieldErrors.title ? 'border-red-500' : ''}`}
        />
        {fieldErrors.title && (
          <p className="mt-1 text-xs text-red-400">{fieldErrors.title}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          📄 Descrição do Produto
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descreva as características, materiais, tamanhos, cores, diferenciais..."
          rows={5}
          className={`input-field text-sm resize-none ${fieldErrors.description ? 'border-red-500' : ''}`}
        />
        {fieldErrors.description && (
          <p className="mt-1 text-xs text-red-400">{fieldErrors.description}</p>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full text-base flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Gerando assets...
          </>
        ) : (
          <>
            <span>🚀</span>
            Gerar Assets para Shopee
          </>
        )}
      </button>
    </form>
  );
}
