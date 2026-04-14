"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Megaphone,
  Clock,
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Package,
  Calendar,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Oferta {
  id: string;
  nomeProduto: string;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoOriginalUrl: string;
  artePath: string;
  textoOferta: string;
  status: "PRONTA" | "ENVIADA" | "FALHA";
  enviadaParaWhatsApp: boolean;
  enviadaEm: string | null;
  criadaEm: string;
  produto: { id: string; nome: string; fotoUrl: string; ativo: boolean } | null;
}

// Brasília offer schedule
const HORARIOS = [
  "06:30", "08:00", "08:30", "10:00", "10:30",
  "12:00", "12:30", "14:00", "14:30", "16:00",
  "16:30", "18:00", "18:30", "20:00", "21:30",
];

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OfertasPage() {
  const [tab, setTab] = useState<"agenda" | "historico">("agenda");

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <Megaphone className="w-6 h-6 text-yellow-400" />
          <div>
            <h1 className="text-lg font-semibold">Ofertas Automáticas</h1>
            <p className="text-xs text-gray-400">15 envios diários · Importação semanal automática</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {(["agenda", "historico"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors capitalize ${
                tab === t
                  ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {t === "agenda" ? "📅 Agenda" : "📋 Histórico"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "agenda" ? <AgendaTab /> : <HistoricoTab />}
      </div>
    </div>
  );
}

// ── Agenda Tab ────────────────────────────────────────────────────────────────

function AgendaTab() {
  const [firing, setFiring] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; nomeProduto?: string; error?: string } | null>(null);

  // Determine current Brasília time
  const now = new Date();
  const brasiliaMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000 + (-3 * 60 * 60 * 1000);
  const brasilia = new Date(brasiliaMs);
  const hNow = brasilia.getHours();
  const mNow = brasilia.getMinutes();
  const nowTotalMin = hNow * 60 + mNow;

  function slotStatus(horario: string): "done" | "next" | "upcoming" {
    const [h, m] = horario.split(":").map(Number);
    const slotMin = h * 60 + m;
    if (slotMin < nowTotalMin - 15) return "done";
    if (Math.abs(slotMin - nowTotalMin) <= 15) return "next";
    return "upcoming";
  }

  async function handleFireNow() {
    setFiring(true);
    setResult(null);
    try {
      const res = await fetch("/api/cron/oferta?force=1", { method: "POST" });
      const data = await res.json() as { ok: boolean; nomeProduto?: string; error?: string };
      setResult(data);
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setFiring(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Manual fire */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Send className="w-4 h-4 text-yellow-400" /> Disparar oferta agora
        </h2>
        <p className="text-sm text-gray-400 mb-3">
          Seleciona automaticamente o melhor produto pela rotação inteligente, gera a arte e envia no WhatsApp.
        </p>
        <button
          onClick={handleFireNow}
          disabled={firing}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-semibold rounded-lg transition-colors"
        >
          {firing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {firing ? "Enviando..." : "Disparar agora"}
        </button>
        {result && (
          <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg text-sm ${
            result.ok
              ? "bg-green-900/40 text-green-300 border border-green-800"
              : "bg-red-900/40 text-red-300 border border-red-800"
          }`}>
            {result.ok
              ? <><CheckCircle className="w-4 h-4" /> Oferta enviada: <strong>{result.nomeProduto}</strong></>
              : <><XCircle className="w-4 h-4" /> Erro: {result.error}</>
            }
          </div>
        )}
      </div>

      {/* Daily schedule */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-400" /> Agenda diária
          <span className="ml-auto text-xs text-gray-500">Horário de Brasília</span>
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {HORARIOS.map((h) => {
            const st = slotStatus(h);
            return (
              <div
                key={h}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-sm font-medium transition-all ${
                  st === "done"
                    ? "bg-green-900/20 border-green-800 text-green-400"
                    : st === "next"
                    ? "bg-yellow-500/20 border-yellow-500 text-yellow-300 ring-1 ring-yellow-500/50 animate-pulse"
                    : "bg-gray-800/50 border-gray-700 text-gray-400"
                }`}
              >
                <Clock className="w-3.5 h-3.5 mb-1 opacity-70" />
                {h}
                {st === "done" && <span className="text-[10px] mt-0.5">✓ enviado</span>}
                {st === "next" && <span className="text-[10px] mt-0.5">● agora</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          ⚙️ Cron roda a cada 30 min. O endpoint <code>/api/cron/oferta</code> verifica automaticamente se o horário atual coincide com um dos 15 slots (±15 min).
        </p>
      </div>

      {/* Weekly import info */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold mb-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-purple-400" /> Importação semanal
        </h2>
        <p className="text-sm text-gray-400">
          Todo domingo às 23:00 (Brasília), o sistema importa automaticamente o catálogo do fornecedor e notifica você no WhatsApp.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-purple-300">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          <span>Próxima importação: domingo 23:00</span>
        </div>
      </div>
    </div>
  );
}

// ── Histórico Tab ──────────────────────────────────────────────────────────────

function HistoricoTab() {
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"" | "PRONTA" | "ENVIADA" | "FALHA">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Oferta | null>(null);

  const fetchOfertas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      const res = await fetch(`/api/ofertas?${params}`);
      const data = await res.json() as { total: number; ofertas: Oferta[] };
      setOfertas(data.ofertas ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setOfertas([]);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { fetchOfertas(); }, [fetchOfertas]);

  const pages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          <option value="ENVIADA">Enviadas</option>
          <option value="PRONTA">Prontas</option>
          <option value="FALHA">Com falha</option>
        </select>
        <span className="text-sm text-gray-400">{total} registros</span>
        <button
          onClick={() => fetchOfertas()}
          className="ml-auto p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
        </div>
      ) : ofertas.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-500 gap-3">
          <Megaphone className="w-10 h-10 opacity-40" />
          <p className="text-sm">Nenhuma oferta gerada ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ofertas.map((oferta) => (
            <OfertaRow key={oferta.id} oferta={oferta} onClick={() => setSelected(oferta)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg"
          >
            ← Anterior
          </button>
          <span className="text-sm text-gray-400">{page} / {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg"
          >
            Próxima →
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <OfertaModal oferta={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── OfertaRow ─────────────────────────────────────────────────────────────────

function OfertaRow({ oferta, onClick }: { oferta: Oferta; onClick: () => void }) {
  const statusColors = {
    ENVIADA: "text-green-400 bg-green-900/30 border-green-800",
    PRONTA:  "text-blue-400 bg-blue-900/30 border-blue-800",
    FALHA:   "text-red-400 bg-red-900/30 border-red-800",
  };
  const statusIcons = {
    ENVIADA: <CheckCircle className="w-3.5 h-3.5" />,
    PRONTA:  <Clock className="w-3.5 h-3.5" />,
    FALHA:   <XCircle className="w-3.5 h-3.5" />,
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-xl text-left transition-colors"
    >
      {/* Thumb */}
      <div className="w-12 h-12 rounded-lg bg-gray-800 overflow-hidden shrink-0">
        {oferta.produto?.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={oferta.produto.fotoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-5 h-5 text-gray-600" />
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{oferta.nomeProduto}</p>
        <p className="text-xs text-gray-400">
          {fmt(oferta.precoDesconto)} · {fmtDate(oferta.criadaEm)}
        </p>
      </div>
      {/* Status badge */}
      <span className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${statusColors[oferta.status]}`}>
        {statusIcons[oferta.status]}
        {oferta.status}
      </span>
    </button>
  );
}

// ── OfertaModal ────────────────────────────────────────────────────────────────

function OfertaModal({ oferta, onClose }: { oferta: Oferta; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="font-semibold">{oferta.nomeProduto}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Preço Venda</p>
              <p className="font-semibold">{fmt(oferta.precoVenda)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Preço Desconto</p>
              <p className="font-semibold text-green-400">{fmt(oferta.precoDesconto)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Parcelamento</p>
              <p className="font-semibold text-blue-400">10× {fmt(oferta.parcelamento)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Status</p>
              <p className={`font-semibold ${
                oferta.status === "ENVIADA" ? "text-green-400" :
                oferta.status === "FALHA" ? "text-red-400" : "text-blue-400"
              }`}>{oferta.status}</p>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-2">Texto da oferta</p>
            <p className="text-sm whitespace-pre-line">{oferta.textoOferta}</p>
          </div>

          <div className="text-xs text-gray-500 space-y-1">
            <p>Criada em: {fmtDate(oferta.criadaEm)}</p>
            {oferta.enviadaEm && <p>Enviada em: {fmtDate(oferta.enviadaEm)}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
