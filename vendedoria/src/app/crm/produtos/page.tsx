"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Truck, RefreshCw, Upload, Trash2, Search,
  AlertCircle, CheckCircle, Loader2, Plus, Package,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

function fmt(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FornecedorPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [apenasAtivos, setApenasAtivos] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualJson, setManualJson] = useState(
    `[\n  { "nome": "Furadeira Impacto 650W", "preco": 189.90, "categoria": "ferramenta", "fotoUrl": "" }\n]`
  );
  const [manualError, setManualError] = useState("");

  const fetchProdutos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
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

  async function handleImportManual() {
    setManualError("");
    let items: unknown[];
    try { items = JSON.parse(manualJson) as unknown[]; }
    catch { setManualError("JSON inválido."); return; }
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

  async function handleToggle(produto: Produto) {
    setProdutos((prev) => prev.map((p) => p.id === produto.id ? { ...p, ativo: !p.ativo } : p));
    try {
      await fetch("/api/produtos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: produto.id, ativo: !produto.ativo }),
      });
    } catch {
      setProdutos((prev) => prev.map((p) => p.id === produto.id ? { ...p, ativo: produto.ativo } : p));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este produto?")) return;
    setProdutos((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/produtos?id=${id}`, { method: "DELETE" });
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Truck className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Catálogo do Fornecedor</h1>
              <p className="text-xs text-muted-foreground">{total} ferramentas importadas • yanne.vendizap.com</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowManual(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Manual
            </Button>
            <Button
              size="sm"
              onClick={handleImportScraper}
              disabled={importing}
            >
              {importing
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-1.5" />}
              {importing ? "Importando..." : "Importar do Fornecedor"}
            </Button>
          </div>
        </div>

        {/* Import result */}
        {importResult && (
          <div className={cn(
            "mt-3 flex items-start gap-2 p-3 rounded-lg text-sm border",
            importResult.ok
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-red-50 text-red-800 border-red-200"
          )}>
            {importResult.ok
              ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
              : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />}
            <div className="flex-1">
              {importResult.ok ? (
                <span>
                  Concluído — <strong>{importResult.novos}</strong> novos,{" "}
                  <strong>{importResult.atualizados}</strong> atualizados,{" "}
                  <strong>{importResult.ignorados}</strong> ignorados (total: {importResult.total})
                </span>
              ) : (
                <span>{importResult.error}{importResult.detail ? ` — ${importResult.detail}` : ""}</span>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-current opacity-50 hover:opacity-100 text-lg leading-none">×</button>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mt-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto..."
              className="pl-8"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={apenasAtivos}
              onChange={(e) => setApenasAtivos(e.target.checked)}
              className="rounded"
            />
            Apenas ativos
          </label>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Carregando produtos...</span>
          </div>
        ) : produtos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-muted-foreground gap-4">
            <Package className="w-12 h-12 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">Nenhum produto importado</p>
              <p className="text-xs mt-1">Clique em &quot;Importar do Fornecedor&quot; para buscar os produtos de yanne.vendizap.com</p>
            </div>
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
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-xl w-full max-w-2xl shadow-lg">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2 text-foreground">
                <Upload className="w-4 h-4" /> Importação Manual (JSON)
              </h2>
              <button onClick={() => setShowManual(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Cole um array JSON com os campos: <code className="bg-muted px-1 rounded">nome</code>,{" "}
                <code className="bg-muted px-1 rounded">preco</code>, e opcionalmente{" "}
                <code className="bg-muted px-1 rounded">fotoUrl</code>,{" "}
                <code className="bg-muted px-1 rounded">categoria</code>. Somente ferramentas serão importadas.
              </p>
              <textarea
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                rows={10}
                className="w-full bg-muted border border-border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-y text-foreground"
              />
              {manualError && (
                <p className="text-destructive text-sm flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> {manualError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowManual(false)}>Cancelar</Button>
              <Button onClick={handleImportManual} disabled={importing}>
                {importing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Importar
              </Button>
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
    <div className={cn(
      "relative flex flex-col bg-card border border-border rounded-xl overflow-hidden transition-all hover:shadow-md",
      !produto.ativo && "opacity-50"
    )}>
      {/* Image */}
      <div className="aspect-square bg-muted overflow-hidden">
        {produto.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={produto.fotoUrl}
            alt={produto.nome}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Package className="w-10 h-10 opacity-30" />
          </div>
        )}
      </div>

      {/* Badge ativo */}
      {produto.ativo && (
        <div className="absolute top-1.5 right-1.5">
          <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 bg-primary">ativo</Badge>
        </div>
      )}

      {/* Info */}
      <div className="p-2 flex flex-col gap-0.5 flex-1">
        <p className="text-xs font-medium leading-tight line-clamp-2 text-foreground">{produto.nome}</p>
        {produto.categoria && (
          <p className="text-[10px] text-muted-foreground truncate">{produto.categoria}</p>
        )}
        <div className="mt-auto pt-1.5 space-y-0.5 border-t border-border/50">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Custo</span>
            <span className="text-foreground font-medium">{fmt(produto.precoCusto)}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Venda</span>
            <span className="text-primary font-semibold">{fmt(produto.precoVenda)}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">10×</span>
            <span className="text-muted-foreground">{fmt(produto.parcelamento)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-border bg-muted/30">
        <button
          onClick={() => onToggle(produto)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={produto.ativo ? "Desativar" : "Ativar"}
        >
          {produto.ativo
            ? <ToggleRight className="w-5 h-5 text-primary" />
            : <ToggleLeft className="w-5 h-5" />}
        </button>
        <button
          onClick={() => onDelete(produto.id)}
          className="text-muted-foreground hover:text-destructive transition-colors"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
