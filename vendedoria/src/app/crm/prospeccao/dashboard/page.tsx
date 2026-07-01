"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, TrendingUp, Users, Calendar, MessageSquare, ChevronDown } from "lucide-react";

interface MetricasResponse {
  porStatus: Record<string, number>;
  taxaResposta: number;
  taxaQualificacao: number;
  taxaReuniao: number;
  porSegmento: Array<{
    segmentId: string;
    nome: string;
    leads: number;
    abordados: number;
    reunioes: number;
    taxaConversaoTotal: number;
  }>;
}

const ETAPAS_FUNIL = [
  { status: "APROVADO",         label: "Aprovados",       cor: "#6366f1" },
  { status: "ABORDADO",         label: "Abordados",       cor: "#3b82f6" },
  { status: "RESPONDEU",        label: "Responderam",     cor: "#06b6d4" },
  { status: "QUALIFICADO",      label: "Qualificados",    cor: "#10b981" },
  { status: "REUNIAO_AGENDADA", label: "Reunião agendada", cor: "#f59e0b" },
];

function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface OrgOption {
  id: string;
  name: string;
}

export default function DashboardProspeccaoPage() {
  const [organizationId, setOrganizationId] = useState<string>("");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim]       = useState("");
  const [segmentId, setSegmentId]   = useState("");
  const [metricas, setMetricas]     = useState<MetricasResponse | null>(null);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    fetch("/api/prospeccao/segmentos")
      .then((r) => r.json())
      .catch(() => []);
    // carrega orgs de prospecção
    fetch("/api/prospeccao/orgs")
      .then((r) => r.json())
      .then((data: OrgOption[]) => {
        setOrgs(data ?? []);
        if (data?.[0]) setOrganizationId(data[0].id);
      })
      .catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (segmentId)  params.set("segmentId", segmentId);
      if (dataInicio) params.set("dataInicio", dataInicio);
      if (dataFim)    params.set("dataFim", dataFim);
      const res = await fetch(`/api/prospeccao/metricas/${organizationId}?${params}`);
      const data = await res.json() as MetricasResponse;
      setMetricas(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [organizationId, segmentId, dataInicio, dataFim]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const maxFunil = metricas
    ? Math.max(1, ...ETAPAS_FUNIL.map((e) => metricas.porStatus[e.status] ?? 0))
    : 1;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Dashboard de Prospecção</h1>
          <p className="text-sm text-gray-500">Funil B2B — Nexos Brasil</p>
        </div>
        <button
          onClick={() => void carregar()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 px-6 py-3 border-b bg-white">
        {orgs.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Organização</label>
            <div className="relative">
              <select
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="pl-3 pr-8 py-1.5 text-sm border rounded-lg appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">De</label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Até</label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {dataInicio || dataFim ? (
          <button
            onClick={() => { setDataInicio(""); setDataFim(""); }}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Limpar datas
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            icon={<Users className="w-5 h-5 text-blue-500" />}
            label="Taxa de resposta"
            value={metricas ? pct(metricas.taxaResposta) : "—"}
            sub="abordados → responderam"
          />
          <KpiCard
            icon={<MessageSquare className="w-5 h-5 text-cyan-500" />}
            label="Taxa de qualificação"
            value={metricas ? pct(metricas.taxaQualificacao) : "—"}
            sub="responderam → qualificados"
          />
          <KpiCard
            icon={<TrendingUp className="w-5 h-5 text-green-500" />}
            label="Taxa reunião"
            value={metricas ? pct(metricas.taxaReuniao) : "—"}
            sub="qualificados → reunião"
          />
          <KpiCard
            icon={<Calendar className="w-5 h-5 text-amber-500" />}
            label="Reuniões agendadas"
            value={metricas ? fmt(metricas.porStatus["REUNIAO_AGENDADA"] ?? 0) : "—"}
            sub="total"
          />
        </div>

        {/* Funil */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Funil de Conversão</h2>
          <div className="space-y-2">
            {ETAPAS_FUNIL.map((etapa) => {
              const count = metricas?.porStatus[etapa.status] ?? 0;
              const pctWidth = maxFunil > 0 ? (count / maxFunil) * 100 : 0;
              return (
                <div key={etapa.status} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-36 text-right shrink-0">
                    {etapa.label}
                  </span>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div
                      className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                      style={{ width: `${Math.max(pctWidth, count > 0 ? 2 : 0)}%`, backgroundColor: etapa.cor }}
                    >
                      {count > 0 && (
                        <span className="text-white text-xs font-semibold">{fmt(count)}</span>
                      )}
                    </div>
                  </div>
                  {count === 0 && <span className="text-xs text-gray-400 w-6">0</span>}
                </div>
              );
            })}
          </div>

          {/* outros status fora do funil */}
          {metricas && (
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-3">
              {["NOVO", "ENRIQUECIDO", "PONTUADO", "ANALISADO", "DESCARTADO", "PERDIDO"].map((s) => {
                const c = metricas.porStatus[s] ?? 0;
                if (c === 0) return null;
                return (
                  <span key={s} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {s}: {fmt(c)}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Por Segmento */}
        {metricas && metricas.porSegmento.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Comparação por Segmento</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left py-2 font-medium">Segmento</th>
                    <th className="text-right py-2 font-medium">Leads</th>
                    <th className="text-right py-2 font-medium">Abordados</th>
                    <th className="text-right py-2 font-medium">Reuniões</th>
                    <th className="text-right py-2 font-medium">Conv. total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {metricas.porSegmento
                    .sort((a, b) => b.taxaConversaoTotal - a.taxaConversaoTotal)
                    .map((seg) => (
                      <tr key={seg.segmentId} className="hover:bg-gray-50">
                        <td className="py-2.5 font-medium text-gray-800">{seg.nome}</td>
                        <td className="text-right py-2.5 text-gray-600">{fmt(seg.leads)}</td>
                        <td className="text-right py-2.5 text-gray-600">{fmt(seg.abordados)}</td>
                        <td className="text-right py-2.5 text-gray-600">{fmt(seg.reunioes)}</td>
                        <td className="text-right py-2.5">
                          <span className={`font-semibold ${seg.taxaConversaoTotal > 0.05 ? "text-green-600" : "text-gray-600"}`}>
                            {pct(seg.taxaConversaoTotal)}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {loading && !metricas && (
          <div className="flex items-center justify-center h-40 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Carregando métricas...
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-400">{sub}</span>
    </div>
  );
}
