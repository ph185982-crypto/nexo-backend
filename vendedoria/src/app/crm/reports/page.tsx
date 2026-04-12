"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart2, TrendingUp, Package, Bell, Loader2,
  CheckCircle, XCircle, Clock, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, gql } from "@apollo/client";

const GET_ORGS = gql`
  query GetOrgsReports {
    whatsappBusinessOrganizations { id name }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface FunnelEntry { etapa: string; count: number }
interface Conversao7d { date: string; leads: number; convertidos: number }
interface DashboardData {
  metricas: {
    leadsToday: number; ativosAgora: number; pedidosHoje: number;
    taxaConversao: number; receitaEstimada: number;
  };
  alertas: Array<{
    convId: string; name: string; phone: string;
    lastMessageAt: string; etapa: string;
  }>;
  funil: FunnelEntry[];
  conversao7d: Conversao7d[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ETAPA_LABELS: Record<string, string> = {
  NOVO: "Novo",
  PRODUTO_IDENTIFICADO: "Qualificando",
  NEGOCIANDO: "Negociando",
  COLETANDO_DADOS: "Colet. dados",
  PEDIDO_CONFIRMADO: "Confirmado",
  PERDIDO: "Perdido",
};

const ETAPA_COLORS: Record<string, string> = {
  NOVO: "bg-gray-400",
  PRODUTO_IDENTIFICADO: "bg-blue-400",
  NEGOCIANDO: "bg-amber-400",
  COLETANDO_DADOS: "bg-orange-400",
  PEDIDO_CONFIRMADO: "bg-emerald-500",
  PERDIDO: "bg-red-400",
};

const TABS = [
  { id: "conversao", label: "Conversão", icon: TrendingUp },
  { id: "produtos",  label: "Produtos",  icon: Package },
  { id: "followup",  label: "Follow-up", icon: Bell },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Mini bar chart (no external deps) ────────────────────────────────────────

function BarChart({ data, color = "bg-primary" }: {
  data: Array<{ label: string; value: number; value2?: number }>;
  color?: string;
}) {
  const max = Math.max(...data.map(d => Math.max(d.value, d.value2 ?? 0)), 1);
  return (
    <div className="flex items-end gap-1.5 h-32 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full flex items-end justify-center gap-0.5 flex-1">
            <div
              className={cn("w-full rounded-t transition-all", color)}
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
            {d.value2 !== undefined && (
              <div
                className="w-full rounded-t bg-emerald-400 transition-all"
                style={{ height: `${(d.value2 / max) * 100}%` }}
                title={`Convertidos: ${d.value2}`}
              />
            )}
          </div>
          <span className="text-[9px] text-muted-foreground truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, accent = false,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      accent ? "bg-primary text-white border-primary" : "bg-white"
    )}>
      <p className={cn("text-xs font-medium mb-1", accent ? "text-white/70" : "text-muted-foreground")}>
        {label}
      </p>
      <p className={cn("text-2xl font-bold", accent && "text-white")}>{value}</p>
      {sub && <p className={cn("text-xs mt-1", accent ? "text-white/60" : "text-muted-foreground")}>{sub}</p>}
    </div>
  );
}

// ── Tab: Conversão ────────────────────────────────────────────────────────────

function TabConversao({ data }: { data: DashboardData }) {
  const { metricas, funil, conversao7d } = data;
  const chart7d = conversao7d.map(d => ({
    label: new Date(d.date).toLocaleDateString("pt-BR", { weekday: "short" }),
    value: d.leads,
    value2: d.convertidos,
  }));
  const total = funil.reduce((s, e) => s + e.count, 0);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Leads hoje"
          value={String(metricas.leadsToday)}
          sub="novos contatos"
        />
        <MetricCard
          label="Pedidos hoje"
          value={String(metricas.pedidosHoje)}
          sub="confirmados"
          accent
        />
        <MetricCard
          label="Taxa conversão"
          value={`${metricas.taxaConversao.toFixed(1)}%`}
          sub="lead → pedido"
        />
        <MetricCard
          label="Receita estimada"
          value={formatBRL(metricas.receitaEstimada)}
          sub="pedidos × R$539,99"
        />
      </div>

      {/* 7-day chart */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Leads × Pedidos — últimos 7 dias</h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />Leads</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />Pedidos</span>
          </div>
        </div>
        {chart7d.length > 0
          ? <BarChart data={chart7d} />
          : <p className="text-xs text-muted-foreground py-8 text-center">Sem dados disponíveis</p>}
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="text-sm font-semibold mb-3">Funil de vendas</h3>
        <div className="space-y-2">
          {funil.map(({ etapa, count }) => (
            <div key={etapa} className="flex items-center gap-2">
              <span className="text-xs w-32 shrink-0 text-muted-foreground truncate">
                {ETAPA_LABELS[etapa] ?? etapa}
              </span>
              <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all flex items-center justify-end pr-2", ETAPA_COLORS[etapa] ?? "bg-gray-400")}
                  style={{ width: total > 0 ? `${Math.max((count / total) * 100, 3)}%` : "3%" }}
                >
                  {count > 0 && <span className="text-[10px] text-white font-bold">{count}</span>}
                </div>
              </div>
              <span className="text-xs font-mono w-8 text-right text-muted-foreground">{count}</span>
            </div>
          ))}
          {funil.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">Nenhum lead no funil</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Produtos ─────────────────────────────────────────────────────────────

function TabProdutos({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Array<{ produto: string; count: number; pedidos: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    fetch(`/api/leads?organizationId=${orgId}`)
      .then(r => r.json())
      .then((leads: Array<{ conversations?: Array<{ produtoInteresse?: string | null; etapa?: string }> }>) => {
        const map: Record<string, { count: number; pedidos: number }> = {};
        for (const lead of leads) {
          const conv = lead.conversations?.[0];
          const prod = conv?.produtoInteresse ?? "NÃO IDENTIFICADO";
          if (!map[prod]) map[prod] = { count: 0, pedidos: 0 };
          map[prod].count++;
          if (conv?.etapa === "PEDIDO_CONFIRMADO") map[prod].pedidos++;
        }
        setRows(Object.entries(map).map(([produto, d]) => ({ produto, ...d })).sort((a, b) => b.count - a.count));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const maxCount = Math.max(...rows.map(r => r.count), 1);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4">
        <h3 className="text-sm font-semibold mb-4">Interesse por produto</h3>
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.produto} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate flex-1">{r.produto.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground ml-2 shrink-0">
                  {r.count} leads · {r.pedidos} pedidos
                  {r.count > 0 && ` · ${((r.pedidos / r.count) * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${(r.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">Nenhum dado de produto</p>
          )}
        </div>
      </div>

      {/* Conversion by product table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Conversão por produto</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Produto</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Leads</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Pedidos</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Taxa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.produto} className={cn("border-t", i % 2 === 0 ? "" : "bg-muted/20")}>
                <td className="px-4 py-2.5 font-medium">{r.produto.replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-right">{r.count}</td>
                <td className="px-4 py-2.5 text-right">{r.pedidos}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full",
                    r.count > 0 && (r.pedidos / r.count) >= 0.3
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {r.count > 0 ? `${((r.pedidos / r.count) * 100).toFixed(0)}%` : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhum dado</p>
        )}
      </div>
    </div>
  );
}

// ── Tab: Follow-up ────────────────────────────────────────────────────────────

function TabFollowup({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Array<{
    id: string; name: string; phone: string;
    step: number; nextSendAt: string; status: string;
    etapa: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const formatPhone = (raw: string) => {
    const d = raw.replace(/\D/g, "");
    const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
    if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
    return local || raw;
  };

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    fetch(`/api/leads?organizationId=${orgId}`)
      .then(r => r.json())
      .then((leads: Array<{
        id: string;
        profileName?: string | null;
        phoneNumber: string;
        conversations?: Array<{
          etapa?: string;
          followUp?: { status: string; step: number; nextSendAt: string } | null;
        }>;
      }>) => {
        const result: typeof rows = [];
        for (const lead of leads) {
          const conv = lead.conversations?.[0];
          const fu = conv?.followUp;
          if (!fu) continue;
          result.push({
            id: lead.id,
            name: lead.profileName ?? lead.phoneNumber,
            phone: lead.phoneNumber,
            step: fu.step,
            nextSendAt: fu.nextSendAt,
            status: fu.status,
            etapa: conv?.etapa ?? "NOVO",
          });
        }
        setRows(result.sort((a, b) => new Date(a.nextSendAt).getTime() - new Date(b.nextSendAt).getTime()));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const active   = rows.filter(r => r.status === "ACTIVE");
  const done     = rows.filter(r => r.status === "DONE");
  const canceled = rows.filter(r => r.status === "CANCELED");

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{active.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Ativos</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{done.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Concluídos</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-400">{canceled.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Cancelados</div>
        </div>
      </div>

      {/* Active follow-ups */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Follow-ups ativos</h3>
          <span className="ml-auto text-xs text-muted-foreground">{active.length} pendentes</span>
        </div>
        <div className="divide-y">
          {active.map(r => {
            const isOverdue = new Date(r.nextSendAt) < new Date();
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0",
                  isOverdue ? "bg-red-500" : "bg-amber-500"
                )}>
                  F{r.step}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{formatPhone(r.phone)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("text-xs font-medium", isOverdue ? "text-red-600" : "text-muted-foreground")}>
                    {isOverdue ? "Atrasado" : new Date(r.nextSendAt).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{ETAPA_LABELS[r.etapa] ?? r.etapa}</p>
                </div>
              </div>
            );
          })}
          {active.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-8 justify-center text-muted-foreground">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="text-sm">Nenhum follow-up pendente</span>
            </div>
          )}
        </div>
      </div>

      {/* Done / Canceled summary */}
      {(done.length > 0 || canceled.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <h4 className="text-sm font-semibold">Concluídos</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {done.length} leads responderam ou compraram durante o fluxo.
            </p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-gray-400" />
              <h4 className="text-sm font-semibold">Cancelados</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {canceled.length} leads tiveram o follow-up cancelado (humanTakeover ou CEP).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState("conversao");
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];
  const [orgId, setOrgId] = useState("");
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  useEffect(() => {
    if (!orgId && orgs.length > 0) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  const fetchDash = useCallback(async () => {
    if (!orgId) return;
    setLoadingDash(true);
    try {
      const res = await fetch(`/api/dashboard?organizationId=${orgId}`);
      setDashData(await res.json() as DashboardData);
    } finally {
      setLoadingDash(false);
    }
  }, [orgId]);

  useEffect(() => { void fetchDash(); }, [fetchDash]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-background">
      {/* Page header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <BarChart2 className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-base font-semibold flex-1">Relatórios</h1>
        {orgs.length > 1 && (
          <select
            value={orgId}
            onChange={e => setOrgId(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2"
          >
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {loadingDash && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
      </div>

      {/* Tabs */}
      <div className="border-b bg-white flex-shrink-0">
        <div className="flex px-4">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "conversao" && (
          dashData
            ? <TabConversao data={dashData} />
            : <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
        )}
        {activeTab === "produtos" && orgId && <TabProdutos orgId={orgId} />}
        {activeTab === "followup" && orgId && <TabFollowup orgId={orgId} />}
      </div>
    </div>
  );
}
