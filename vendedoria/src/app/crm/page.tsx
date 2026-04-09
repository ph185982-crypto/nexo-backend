"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, Users, MessageSquare, CheckCircle2,
  AlertTriangle, MapPin, RefreshCw, ChevronRight, Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Period = "today" | "7d" | "30d";

interface DashboardStats {
  totalConversas: number;
  pedidosConfirmados: number;
  taxaConversao: number;
  escalados: number;
  perdidos: number;
  foraArea: number;
  conversasAtivas: number;
  totalMsgsClientes: number;
}

interface FunnelStep {
  etapa: string;
  count: number;
}

interface RecentConv {
  id: string;
  name: string;
  phone: string;
  etapa: string;
  foraAreaEntrega: boolean;
  humanTakeover: boolean;
  leadStatus: string;
  lastMessageAt: string | null;
  lastMessage: string;
  lastMessageRole: string;
}

interface DashboardData {
  period: string;
  stats: DashboardStats;
  funnel: FunnelStep[];
  recentConversations: RecentConv[];
}

const ETAPA_LABELS: Record<string, string> = {
  NOVO: "Novo",
  PRODUTO_IDENTIFICADO: "Produto ID",
  MIDIA_ENVIADA: "Mídia enviada",
  QUALIFICANDO: "Qualificando",
  NEGOCIANDO: "Negociando",
  COLETANDO_DADOS: "Coletando dados",
  PEDIDO_CONFIRMADO: "Pedido confirmado",
  PERDIDO: "Perdido",
};

const ETAPA_COLOR: Record<string, string> = {
  NOVO: "bg-slate-100 text-slate-700",
  PRODUTO_IDENTIFICADO: "bg-blue-100 text-blue-700",
  MIDIA_ENVIADA: "bg-indigo-100 text-indigo-700",
  QUALIFICANDO: "bg-purple-100 text-purple-700",
  NEGOCIANDO: "bg-amber-100 text-amber-700",
  COLETANDO_DADOS: "bg-orange-100 text-orange-700",
  PEDIDO_CONFIRMADO: "bg-green-100 text-green-700",
  PERDIDO: "bg-red-100 text-red-700",
};

const FUNNEL_BAR_COLOR: Record<string, string> = {
  NOVO: "#94a3b8",
  PRODUTO_IDENTIFICADO: "#60a5fa",
  MIDIA_ENVIADA: "#818cf8",
  QUALIFICANDO: "#a78bfa",
  NEGOCIANDO: "#fbbf24",
  COLETANDO_DADOS: "#f97316",
  PEDIDO_CONFIRMADO: "#22c55e",
  PERDIDO: "#ef4444",
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function StatusBadge({ conv }: { conv: RecentConv }) {
  if (conv.leadStatus === "ESCALATED" || conv.humanTakeover) {
    return <Badge className="bg-orange-100 text-orange-700 text-xs">Humano</Badge>;
  }
  if (conv.foraAreaEntrega) {
    return <Badge className="bg-gray-100 text-gray-600 text-xs">Fora área</Badge>;
  }
  const label = ETAPA_LABELS[conv.etapa] ?? conv.etapa;
  const cls = ETAPA_COLOR[conv.etapa] ?? "bg-slate-100 text-slate-700";
  return <Badge className={cn("text-xs", cls)}>{label}</Badge>;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingPassagem, setTestingPassagem] = useState(false);
  const [testPassagemResult, setTestPassagemResult] = useState<string | null>(null);
  const [testPassagemDiag, setTestPassagemDiag] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?period=${p}`);
      if (res.ok) setData(await res.json() as DashboardData);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTestPassagem = useCallback(async () => {
    setTestingPassagem(true);
    setTestPassagemResult(null);
    setTestPassagemDiag(null);
    try {
      const res = await fetch("/api/debug/test-passagem", { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string; message?: string; diag?: Record<string, unknown> };
      setTestPassagemDiag(json.diag ?? null);
      if (json.ok) {
        setTestPassagemResult(`✅ ${json.message ?? "Enviado com sucesso"}`);
        setTimeout(() => { setTestPassagemResult(null); setTestPassagemDiag(null); }, 15000);
      } else {
        setTestPassagemResult(`❌ ${json.error ?? "Erro desconhecido"}`);
      }
    } catch (e) {
      setTestPassagemResult(`❌ Erro de rede: ${String(e)}`);
    } finally {
      setTestingPassagem(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  const stats = data?.stats;
  const funnel = data?.funnel ?? [];
  const recents = data?.recentConversations ?? [];
  const maxFunnelCount = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel de vendas</h1>
          <p className="text-sm text-muted-foreground">Funil do agente Léo — Nexo Brasil</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["today", "7d", "30d"] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => load(period)} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleTestPassagem}
            disabled={testingPassagem}
            className="border-green-200 text-green-700 hover:bg-green-50 gap-1.5"
          >
            {testingPassagem
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            Testar passagem
          </Button>
        </div>
      </div>
      {(testPassagemResult || testPassagemDiag) && (
        <div className={cn(
          "text-sm px-3 py-2 rounded-lg border space-y-2",
          testPassagemResult?.startsWith("✅")
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-800"
        )}>
          {testPassagemResult && <p className="font-medium">{testPassagemResult}</p>}
          {testPassagemDiag && (
            <pre className="text-[10px] leading-4 overflow-x-auto whitespace-pre-wrap opacity-80">
              {JSON.stringify(testPassagemDiag, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={MessageSquare}
          label="Conversas"
          value={stats?.totalConversas ?? 0}
          color="#6366f1"
          loading={loading}
        />
        <StatCard
          icon={CheckCircle2}
          label="Pedidos confirmados"
          value={stats?.pedidosConfirmados ?? 0}
          color="#22c55e"
          loading={loading}
          sub={stats ? `${stats.taxaConversao}% de conversão` : undefined}
        />
        <StatCard
          icon={Users}
          label="Ativas agora"
          value={stats?.conversasAtivas ?? 0}
          color="#f59e0b"
          loading={loading}
        />
        <StatCard
          icon={AlertTriangle}
          label="Escalados"
          value={stats?.escalados ?? 0}
          color="#ef4444"
          loading={loading}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-4">
        <MiniStat label="Fora da área" value={stats?.foraArea ?? 0} icon={MapPin} color="text-slate-500" loading={loading} />
        <MiniStat label="Perdidos" value={stats?.perdidos ?? 0} icon={TrendingUp} color="text-red-500" loading={loading} />
        <MiniStat label="Msgs clientes" value={stats?.totalMsgsClientes ?? 0} icon={MessageSquare} color="text-blue-500" loading={loading} />
      </div>

      {/* Funil de conversão */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Funil de conversão por etapa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {funnel.filter((f) => f.count > 0 || f.etapa === "PEDIDO_CONFIRMADO").map((step) => (
            <div key={step.etapa} className="flex items-center gap-3">
              <div className="w-36 text-xs text-right text-muted-foreground shrink-0">
                {ETAPA_LABELS[step.etapa] ?? step.etapa}
              </div>
              <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(2, Math.round((step.count / maxFunnelCount) * 100))}%`,
                    backgroundColor: FUNNEL_BAR_COLOR[step.etapa] ?? "#94a3b8",
                  }}
                />
              </div>
              <div className="w-8 text-xs font-semibold text-right shrink-0">{step.count}</div>
            </div>
          ))}
          {funnel.every((f) => f.count === 0) && !loading && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma conversa no período selecionado.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Conversas recentes */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">Conversas recentes</CardTitle>
          <Link href="/crm/conversations">
            <Button variant="ghost" size="sm" className="text-xs gap-1">
              Ver todas <ChevronRight className="w-3 h-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {loading && recents.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Carregando...</div>
          ) : recents.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhuma conversa no período selecionado.
            </div>
          ) : (
            <div className="divide-y">
              {recents.map((conv) => (
                <Link key={conv.id} href={`/crm/conversations?id=${conv.id}`}>
                  <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-indigo-700 font-semibold text-sm">
                      {(conv.name?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{conv.name}</span>
                        <StatusBadge conv={conv} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.lastMessageRole === "ASSISTANT" ? "🤖 " : "👤 "}
                        {conv.lastMessage || "..."}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {relativeTime(conv.lastMessageAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  loading: boolean;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p
              className={cn("text-2xl font-bold transition-opacity", loading && "opacity-40")}
              style={{ color }}
            >
              {value.toLocaleString("pt-BR")}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className={cn("w-4 h-4 shrink-0", color)} />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className={cn("text-lg font-bold", loading && "opacity-40")}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
