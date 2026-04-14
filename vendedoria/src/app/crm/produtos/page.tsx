"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Package,
  RefreshCw,
  Upload,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Search,
  AlertCircle,
  CheckCircle,
  Loader2,
  Plus,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Produto {
  id: string;
  nome: string;
  slug: string;
  precoCusto: number;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoUrl: string;
  descricao?: string;
  categoria?: string;
  ativo: boolean;
  importadoEm: string;
  ultimaOfertaEm?: string;
  vezesUsadoEmOferta: number;
}

interface ImportResult {
  ok: boolean;
  total: number;
  novos: number;
  atualizados: number;
  ignorados: number;
  error?: string;
  detail?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProdutosPage() {
  const { data: session } = useSession();

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [apenasAtivos, setApenasAtivos] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Manual import modal
  const [showManual, setShowManual] = useState(false);
  const [manualJson, setManualJson] = useState(`[
  { "nome": "Furadeira Impacto 650W", "preco": 189.90, "categoria": "ferramenta", "fotoUrl": "" },
  { "nome": "Chave Combinada 13mm", "preco": 12.50, "categoria": "ferramenta", "fotoUrl": "" }
]`);
  const [manualError, setManualError] = useState("");

  // ── Fetch products ──────────────────────────────────────────────────────────

  const fetchProdutos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q) params.set("q", q);
      if (apenasAtivos) params.set("ativo", "true");
      const res = await fetch(`/api/produtos?${params}`);
      const data = await res.json() as { total: number; produtos: Produto[] };
      setProdutos(data.produtos ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setProdutos([]);
    } finally {
      setLoading(false);
    }
  }, [q, apenasAtivos]);

  useEffect(() => { fetchProdutos(); }, [fetchProdutos]);

  // ── Scraper import ──────────────────────────────────────────────────────────

  async function handleImportScraper() {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/produtos/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "scraper" }),
      });
      const data = await res.json() as ImportResult;
      setImportResult(data);
      if (data.ok) fetchProdutos();
    } catch (err) {
      setImportResult({ ok: false, total: 0, novos: 0, atualizados: 0, ignorados: 0, error: String(err) });
    } finally {
      setImporting(false);
    }
  }

  // ── Manual import ───────────────────────────────────────────────────────────

  async function handleImportManual() {
    setManualError("");
    let items: unknown[];
    try {
      items = JSON.parse(manualJson) as unknown[];
    } catch {
      setManualError("JSON inválido.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/produtos/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "manual", items }),
      });
      const data = await res.json() as ImportResult;
      setImportResult(data);
      if (data.ok) { setShowManual(false); fetchProdutos(); }
    } catch (err) {
      setImportResult({ ok: false, total: 0, novos: 0, atualizados: 0, ignorados: 0, error: String(err) });
    } finally {
      setImporting(false);
    }
  }

  // ── Toggle active ───────────────────────────────────────────────────────────

  async function handleToggle(produto: Produto) {
    const optimistic = produtos.map((p) => p.id === produto.id ? { ...p, ativo: !p.ativo } : p);
    setProdutos(optimistic);
    try {
      await fetch("/api/produtos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: produto.id, ativo: !produto.ativo }),
      });
    } catch {
      setProdutos(produtos); // revert
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm("Remover este produto?")) return;
    setProdutos((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/produtos?id=${id}`, { method: "DELETE" });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="text-lg font-semibold">Produtos do Fornecedor</h1>
              <p className="text-xs text-gray-400">{total} ferramentas cadastradas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Manual
            </button>
            <button
              onClick={handleImportScraper}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Importar do Fornecedor
            </button>
          </div>
        </div>

        {/* Import result banner */}
        {importResult && (
          <div className={`mt-3 flex items-start gap-2 p-3 rounded-lg text-sm ${
            importResult.ok ? "bg-green-900/40 text-green-300 border border-green-800" : "bg-red-900/40 text-red-300 border border-red-800"
          }`}>
            {importResult.ok ? (
              <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div>
              {importResult.ok ? (
                <span>
                  Importação concluída — <strong>{importResult.novos}</strong> novos,{" "}
                  <strong>{importResult.atualizados}</strong> atualizados,{" "}
                  <strong>{importResult.ignorados}</strong> ignorados (total: {importResult.total})
                </span>
              ) : (
                <span>{importResult.error}{importResult.detail ? ` — ${importResult.detail}` : ""}</span>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="ml-auto text-current opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mt-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={apenasAtivos}
              onChange={(e) => setApenasAtivos(e.target.checked)}
              className="accent-blue-500"
            />
            Apenas ativos
          </label>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
          </div>
        ) : produtos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500 gap-3">
            <Package className="w-10 h-10 opacity-40" />
            <p className="text-sm">Nenhum produto cadastrado. Clique em "Importar do Fornecedor".</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {produtos.map((produto) => (
              <ProdutoCard
                key={produto.id}
                produto={produto}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Manual import modal */}
      {showManual && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h2 className="font-semibold flex items-center gap-2">
                <Upload className="w-4 h-4" /> Importação Manual (JSON)
              </h2>
              <button onClick={() => setShowManual(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">
                Cole um array JSON com os campos: <code className="text-blue-300">nome</code>, <code className="text-blue-300">preco</code>, e opcionalmente <code className="text-blue-300">fotoUrl</code>, <code className="text-blue-300">categoria</code>, <code className="text-blue-300">descricao</code>.
                Somente ferramentas serão importadas.
              </p>
              <textarea
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                rows={10}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
              />
              {manualError && (
                <p className="text-red-400 text-sm flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> {manualError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-800">
              <button
                onClick={() => setShowManual(false)}
                className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleImportManual}
                disabled={importing}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg flex items-center gap-2"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ProdutoCard ────────────────────────────────────────────────────────────────

function ProdutoCard({
  produto,
  onToggle,
  onDelete,
}: {
  produto: Produto;
  onToggle: (p: Produto) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`relative flex flex-col bg-gray-900 border rounded-xl overflow-hidden transition-all ${
      produto.ativo ? "border-gray-700" : "border-gray-800 opacity-60"
    }`}>
      {/* Image */}
      <div className="aspect-square bg-gray-800 overflow-hidden">
        {produto.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={produto.fotoUrl}
            alt={produto.nome}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Package className="w-10 h-10" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-medium leading-tight line-clamp-2">{produto.nome}</p>
        <div className="mt-auto space-y-0.5">
          <p className="text-xs text-gray-400">Custo: <span className="text-white">{fmt(produto.precoCusto)}</span></p>
          <p className="text-xs text-gray-400">Venda: <span className="text-green-400 font-medium">{fmt(produto.precoVenda)}</span></p>
          <p className="text-xs text-gray-400">Desc.: <span className="text-yellow-400">{fmt(produto.precoDesconto)}</span></p>
          <p className="text-xs text-gray-400">10×: <span className="text-blue-400">{fmt(produto.parcelamento)}</span></p>
        </div>
        {produto.vezesUsadoEmOferta > 0 && (
          <p className="text-[10px] text-gray-500 mt-1">📤 {produto.vezesUsadoEmOferta}× em ofertas</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-gray-800 bg-gray-900/80">
        <button
          onClick={() => onToggle(produto)}
          className="text-gray-400 hover:text-white transition-colors"
          title={produto.ativo ? "Desativar" : "Ativar"}
        >
          {produto.ativo ? (
            <ToggleRight className="w-5 h-5 text-green-400" />
          ) : (
            <ToggleLeft className="w-5 h-5" />
          )}
        </button>
        <button
          onClick={() => onDelete(produto.id)}
          className="text-gray-600 hover:text-red-400 transition-colors"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
