"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Users, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Etapa =
  | "NOVO"
  | "PRODUTO_IDENTIFICADO"
  | "MIDIA_ENVIADA"
  | "QUALIFICANDO"
  | "NEGOCIANDO"
  | "COLETANDO_DADOS"
  | "PEDIDO_CONFIRMADO"
  | "PERDIDO";

interface FollowUp {
  status: string;
  step: number;
  nextSendAt?: string | null;
}

interface Conversation {
  id: string;
  profileName?: string | null;
  customerWhatsappBusinessId: string;
  etapa: Etapa;
  humanTakeover: boolean;
  lastMessageAt?: string | null;
  createdAt: string;
  leadId: string;
  followUp?: FollowUp | null;
}

interface CountRow { etapa: string; _count: { _all: number }; }

interface MonitorData {
  conversations: Conversation[];
  counts: CountRow[];
  total: number;
  humanCount: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ETAPA_LABEL: Record<Etapa, string> = {
  NOVO:                "Novo",
  PRODUTO_IDENTIFICADO:"Produto ID",
  MIDIA_ENVIADA:       "Mídia Enviada",
  QUALIFICANDO:        "Qualificando",
  NEGOCIANDO:          "Negociando",
  COLETANDO_DADOS:     "Coletando Dados",
  PEDIDO_CONFIRMADO:   "Confirmado",
  PERDIDO:             "Perdido",
};

const ETAPA_COLOR: Record<Etapa, string> = {
  NOVO:                "bg-slate-100   text-slate-700   border-slate-200",
  PRODUTO_IDENTIFICADO:"bg-blue-100    text-blue-700    border-blue-200",
  MIDIA_ENVIADA:       "bg-indigo-100  text-indigo-700  border-indigo-200",
  QUALIFICANDO:        "bg-amber-100   text-amber-700   border-amber-200",
  NEGOCIANDO:          "bg-orange-100  text-orange-700  border-orange-200",
  COLETANDO_DADOS:     "bg-violet-100  text-violet-700  border-violet-200",
  PEDIDO_CONFIRMADO:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  PERDIDO:             "bg-red-100     text-red-700     border-red-200",
};

const ETAPA_ICON: Record<Etapa, React.ReactNode> = {
  NOVO:                <span className="text-slate-400">●</span>,
  PRODUTO_IDENTIFICADO:<span className="text-blue-400">●</span>,
  MIDIA_ENVIADA:       <span className="text-indigo-400">●</span>,
  QUALIFICANDO:        <span className="text-amber-400">●</span>,
  NEGOCIANDO:          <span className="text-orange-400">●</span>,
  COLETANDO_DADOS:     <span className="text-violet-400">●</span>,
  PEDIDO_CONFIRMADO:   <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  PERDIDO:             <XCircle className="w-3.5 h-3.5 text-red-500" />,
};

const FOLLOWUP_STATUS_LABEL: Record<string, string> = {
  ACTIVE:    "Follow-up ativo",
  COMPLETED: "Follow-up concluído",
  CANCELLED: "Follow-up cancelado",
  EXPIRED:   "Follow-up expirado",
};

const ALL_ETAPAS = Object.keys(ETAPA_LABEL) as Etapa[];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoDate?: string | null): string {
  if (!isoDate) return "—";
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "agora";
  if (mins < 60)  return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function phoneDisplay(raw: string): string {
  // Strip @s.whatsapp.net if present, format as +XX XX XXXXX-XXXX
  const digits = raw.replace(/@.*/, "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return digits || raw;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-orange-500",
  "bg-rose-500", "bg-cyan-500", "bg-amber-500", "bg-indigo-500",
];

function Avatar({ name, id }: { name?: string | null; id: string }) {
  const color = AVATAR_COLORS[parseInt(id.slice(-2), 16) % AVATAR_COLORS.length];
  return (
    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0", color)}>
      {initials(name)}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ etapa, count, active, onClick }: { etapa: Etapa; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 p-3 rounded-xl border text-left transition-all hover:shadow-sm",
        active ? "border-primary/40 ring-1 ring-primary/30 bg-primary/5" : "bg-white hover:border-primary/20"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{ETAPA_LABEL[etapa]}</span>
        {ETAPA_ICON[etapa]}
      </div>
      <span className="text-2xl font-bold text-foreground">{count}</span>
    </button>
  );
}

// ─── Conversation card ────────────────────────────────────────────────────────

function ConversationCard({ conv }: { conv: Conversation }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-white hover:shadow-sm transition-shadow">
      <Avatar name={conv.profileName} id={conv.id} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-medium text-sm truncate max-w-[140px]">
            {conv.profileName ?? "Cliente"}
          </span>
          <Badge variant="outline" className={cn("text-xs flex-shrink-0", ETAPA_COLOR[conv.etapa as Etapa] ?? "bg-gray-100 text-gray-700 border-gray-200")}>
            {ETAPA_LABEL[conv.etapa as Etapa] ?? conv.etapa}
          </Badge>
          {conv.humanTakeover && (
            <Badge variant="outline" className="text-xs text-red-700 border-red-200 bg-red-50 flex-shrink-0">
              <AlertTriangle className="w-3 h-3 mr-1" /> Humano
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-1.5">
          {phoneDisplay(conv.customerWhatsappBusinessId)}
        </p>

        {conv.followUp && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {FOLLOWUP_STATUS_LABEL[conv.followUp.status] ?? conv.followUp.status}
              {conv.followUp.step > 0 && ` · step ${conv.followUp.step}`}
            </span>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground flex-shrink-0 text-right">
        <span className="block">{timeAgo(conv.lastMessageAt)}</span>
        {conv.humanTakeover && (
          <span className="block mt-1 text-red-500 font-medium">intervenção</span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AILeadsPage() {
  const [data,      setData]      = useState<MonitorData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterEtapa, setFilterEtapa]   = useState<Etapa | null>(null);
  const [humanOnly,   setHumanOnly]     = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else         setRefreshing(true);
    try {
      const params = new URLSearchParams({ take: "80" });
      if (filterEtapa) params.set("etapa", filterEtapa);
      if (humanOnly)   params.set("human", "true");
      const r = await fetch(`/api/ai/monitor?${params}`);
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      // silent fail — keep stale data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterEtapa, humanOnly]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const countFor = (etapa: Etapa) =>
    data?.counts.find(c => c.etapa === etapa)?._count._all ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white flex-shrink-0">
        <Activity className="w-5 h-5 text-primary flex-shrink-0" />
        <h1 className="font-semibold text-lg">Monitor de Leads</h1>

        <div className="ml-auto flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {data.total} conversas · {data.humanCount} com humano
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            className="gap-1.5 h-8"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5 max-w-5xl mx-auto">

          {/* ── Stat grid ── */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {ALL_ETAPAS.map(etapa => (
                <StatCard
                  key={etapa}
                  etapa={etapa}
                  count={countFor(etapa)}
                  active={filterEtapa === etapa}
                  onClick={() => setFilterEtapa(filterEtapa === etapa ? null : etapa)}
                />
              ))}
            </div>
          )}

          {/* ── Filter pills ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setFilterEtapa(null); setHumanOnly(false); }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                !filterEtapa && !humanOnly
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-muted-foreground border-border hover:border-primary/40"
              )}
            >
              <Users className="w-3 h-3 inline mr-1" />
              Todos {data && `(${data.total})`}
            </button>

            <button
              onClick={() => { setHumanOnly(h => !h); setFilterEtapa(null); }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                humanOnly
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-muted-foreground border-border hover:border-red-300"
              )}
            >
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Humano {data && `(${data.humanCount})`}
            </button>

            {ALL_ETAPAS.map(etapa => {
              const count = countFor(etapa);
              if (count === 0) return null;
              return (
                <button
                  key={etapa}
                  onClick={() => setFilterEtapa(filterEtapa === etapa ? null : etapa)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    filterEtapa === etapa
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-muted-foreground border-border hover:border-primary/40"
                  )}
                >
                  {ETAPA_LABEL[etapa]} ({count})
                </button>
              );
            })}
          </div>

          {/* ── Conversations list ── */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : !data || data.conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Users className="w-12 h-12 opacity-20" />
              <p className="text-sm">
                {filterEtapa || humanOnly
                  ? "Nenhuma conversa encontrada com esses filtros."
                  : "Nenhuma conversa ativa no momento."}
              </p>
              {(filterEtapa || humanOnly) && (
                <button
                  onClick={() => { setFilterEtapa(null); setHumanOnly(false); }}
                  className="text-xs text-primary hover:underline"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.conversations.map(conv => (
                <ConversationCard key={conv.id} conv={conv} />
              ))}
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
