"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQuery, gql } from "@apollo/client";
import { useRouter } from "next/navigation";
import { Loader2, TrendingUp, Users, ShoppingBag, BarChart2, DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const GET_ORGS = gql`query { whatsappBusinessOrganizations { id name } }`;

interface Metrica { leadsToday: number; ativosAgora: number; pedidosHoje: number; taxaConversao: number; receitaEstimada: number }
interface Alerta { leadId: string; name: string; etapa: string; lastMessageAt: string | null; tipo: string }
interface FunilItem { etapa: string; count: number }
interface Dia7 { date: string; taxa: number }
interface DashData { metricas: Metrica; alertas: Alerta[]; funil: FunilItem[]; conversao7d: Dia7[] }

const ETAPA_LABEL: Record<string, string> = {
  NOVO: "Novo", PRODUTO_IDENTIFICADO: "Qualificando", QUALIFICANDO: "Qualificando",
  NEGOCIANDO: "Negociando", COLETANDO_DADOS: "Coletando dados",
  PEDIDO_CONFIRMADO: "Confirmado", PERDIDO: "Perdido",
};

function MetricCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border p-4 flex items-start gap-3">
      <div className={cn("p-2 rounded-lg shrink-0", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--texto-secundario)]">{label}</p>
        <p className="text-xl font-bold text-[var(--texto)] truncate">{value}</p>
        {sub && <p className="text-xs text-[var(--texto-terciario)]">{sub}</p>}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];
  const [orgId, setOrgId] = useState("");
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!orgId && orgs.length > 0) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/dashboard?organizationId=${orgId}`);
      setData(await r.json() as DashData);
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => { const t = setInterval(() => void fetchData(), 30000); return () => clearInterval(t); }, [fetchData]);

  const m = data?.metricas;
  const maxFunil = Math.max(...(data?.funil?.map(f => f.count) ?? [1]), 1);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--fundo)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-[var(--texto)]">Dashboard</h1>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard icon={Users} label="Leads hoje" value={String(m?.leadsToday ?? 0)} color="bg-blue-50 text-blue-600" />
        <MetricCard icon={TrendingUp} label="Ativos agora" value={String(m?.ativosAgora ?? 0)} color="bg-green-50 text-green-600" />
        <MetricCard icon={ShoppingBag} label="Pedidos hoje" value={String(m?.pedidosHoje ?? 0)} color="bg-purple-50 text-purple-600" />
        <MetricCard icon={BarChart2} label="Conversão" value={`${m?.taxaConversao ?? 0}%`} color="bg-orange-50 text-orange-600" />
        <MetricCard icon={DollarSign} label="Receita est." value={`R$${((m?.receitaEstimada ?? 0)).toLocaleString("pt-BR",{minimumFractionDigits:2})}`} color="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Alertas */}
      {(data?.alertas?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h2 className="font-semibold text-sm mb-3 flex items-center gap-2 text-[var(--texto)]">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            Atenção necessária ({data!.alertas.length})
          </h2>
          <div className="space-y-2">
            {data!.alertas.map((a) => (
              <div key={a.leadId} className="flex items-center gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-xs text-[var(--texto-secundario)]">{ETAPA_LABEL[a.etapa] ?? a.etapa} · {timeAgo(a.lastMessageAt)}</p>
                </div>
                <button
                  onClick={() => router.push(`/crm/conversations?id=${a.leadId}`)}
                  className="text-xs text-blue-600 font-medium hover:underline shrink-0"
                >
                  Ver conversa
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funil */}
      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-semibold text-sm mb-3 text-[var(--texto)]">Funil de conversão</h2>
        <div className="space-y-2">
          {(data?.funil ?? []).filter(f => f.count > 0 || f.etapa !== "PERDIDO").map((f) => (
            <div key={f.etapa} className="flex items-center gap-3">
              <span className="text-xs text-[var(--texto-secundario)] w-28 shrink-0">{ETAPA_LABEL[f.etapa] ?? f.etapa}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-[var(--primaria)] rounded-full transition-all"
                  style={{ width: `${Math.round((f.count / maxFunil) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-[var(--texto)] w-6 text-right">{f.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gráfico 7d — simples sem deps externas */}
      {(data?.conversao7d?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h2 className="font-semibold text-sm mb-3 text-[var(--texto)]">Conversão — últimos 7 dias</h2>
          <div className="flex items-end gap-2 h-24">
            {data!.conversao7d.map((d) => (
              <div key={d.date} className="flex flex-col items-center flex-1 gap-1">
                <span className="text-[10px] text-[var(--texto-secundario)]">{d.taxa}%</span>
                <div className="w-full bg-gray-100 rounded-t overflow-hidden" style={{ height: 64 }}>
                  <div
                    className="bg-[var(--acento)] w-full rounded-t transition-all"
                    style={{ height: `${Math.max(d.taxa, 2)}%`, marginTop: `${100 - Math.max(d.taxa, 2)}%` }}
                  />
                </div>
                <span className="text-[10px] text-[var(--texto-terciario)]">{d.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
