"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  BarChart2, ShoppingBag, Users, MessageSquare, Clock,
  TrendingUp, TrendingDown, RefreshCw, AlertTriangle, BellOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const GET_ORGS = gql`
  query GetOrgsMetrics { whatsappBusinessOrganizations { id name } }
`;

interface Metrics {
  period: string;
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  aiMessages: number;
  orders: number;
  escalations: number;
  optOuts: number;
  followUpsActive: number;
  followUpsDone: number;
  conversionRate: number;
  avgResponseTimeSec: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  trend?: "up" | "down" | "neutral";
}

function StatCard({ title, value, sub, icon: Icon, color, trend }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold" style={{ color }}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            {trend && trend !== "neutral" && (
              trend === "up"
                ? <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                : <TrendingDown className="w-3.5 h-3.5 text-red-500" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const PERIODS = [
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Tudo", value: "all" },
];

export default function MetricsPage() {
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];

  const [orgId, setOrgId] = useState("");
  const [period, setPeriod] = useState("30d");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!orgId && orgs.length > 0) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const fetchMetrics = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics/leo?organizationId=${orgId}&period=${period}`);
      setMetrics(await res.json());
    } finally {
      setLoading(false);
    }
  }, [orgId, period]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Métricas do Léo</h1>
            <p className="text-sm text-muted-foreground">Performance do agente IA de vendas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {orgs.length > 1 && (
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <div className="flex border border-border rounded-md overflow-hidden bg-white">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "px-3 py-2 text-sm transition-colors",
                  period === p.value ? "bg-primary text-white font-medium" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={fetchMetrics} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {!metrics && loading && (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {metrics && (
        <>
          {/* Main KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Taxa de Conversão"
              value={`${metrics.conversionRate}%`}
              sub="pedidos / conversas"
              icon={TrendingUp}
              color="#22c55e"
            />
            <StatCard
              title="Pedidos Fechados"
              value={metrics.orders}
              sub="passagens de bastão"
              icon={ShoppingBag}
              color="#004c3f"
              trend="up"
            />
            <StatCard
              title="Total de Conversas"
              value={metrics.totalConversations}
              sub={`${metrics.activeConversations} ativas (48h)`}
              icon={MessageSquare}
              color="#0891b2"
            />
            <StatCard
              title="Tempo Médio de Resposta"
              value={metrics.avgResponseTimeSec > 0 ? `${metrics.avgResponseTimeSec}s` : "—"}
              sub="da mensagem do cliente até o Léo"
              icon={Clock}
              color="#f97316"
            />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Mensagens da IA"
              value={metrics.aiMessages}
              sub={`de ${metrics.totalMessages} totais`}
              icon={MessageSquare}
              color="#8b5cf6"
            />
            <StatCard
              title="Escalações"
              value={metrics.escalations}
              sub="passados para humano"
              icon={AlertTriangle}
              color="#f97316"
            />
            <StatCard
              title="Opt-outs"
              value={metrics.optOuts}
              sub="pediram para não contatar"
              icon={BellOff}
              color="#ef4444"
            />
            <StatCard
              title="Follow-ups Ativos"
              value={metrics.followUpsActive}
              sub={`${metrics.followUpsDone} concluídos`}
              icon={Users}
              color="#64748b"
            />
          </div>

          {/* Conversion funnel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funil de Conversão</CardTitle>
            </CardHeader>
            <CardContent>
              {[
                { label: "Conversas iniciadas", value: metrics.totalConversations, color: "#0891b2" },
                { label: "Conversas ativas (48h)", value: metrics.activeConversations, color: "#22c55e" },
                { label: "Escaladas para humano", value: metrics.escalations, color: "#f97316" },
                { label: "Pedidos fechados (IA)", value: metrics.orders, color: "#004c3f" },
              ].map((row, i) => {
                const pct = metrics.totalConversations > 0
                  ? Math.round((row.value / metrics.totalConversations) * 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center gap-3 mb-3">
                    <span className="text-sm text-muted-foreground w-52 flex-shrink-0">{row.label}</span>
                    <div className="flex-1 bg-muted rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: row.color }}
                      />
                    </div>
                    <span className="text-sm font-semibold w-20 text-right" style={{ color: row.color }}>
                      {row.value} <span className="text-xs text-muted-foreground font-normal">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
