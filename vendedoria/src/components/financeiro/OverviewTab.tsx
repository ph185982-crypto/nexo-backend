"use client";

import React, { useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, DollarSign, ArrowUp, ArrowDown, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const DONUT_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
];

interface Comparativo {
  atual: number;
  anterior: number;
  variacaoPct: number | null;
}

interface ReceitaPrevistaResumo {
  id: string;
  descricao: string;
  valor: number;
  data_prevista: string;
  cliente: string | null;
  status: string;
}

interface OverviewData {
  receitas: number;
  despesas: number;
  saldo: number;
  meta: { alvo: number; atual: number };
  categorias: Array<{ categoria: string; total: number }>;
  mensal: Array<{ mes: string; receitas: number; despesas: number }>;
  comparativo?: {
    mesAnterior: string;
    receitas: Comparativo;
    despesas: Comparativo;
    saldo: Comparativo;
  };
  receitasPrevistas?: {
    total: number;
    quantidade: number;
    proximas: ReceitaPrevistaResumo[];
  };
}

// Pra despesas, variacao positiva (gastou mais) e ruim -> inverte a cor.
function VariacaoBadge({ variacao, invertColor }: { variacao: Comparativo | undefined; invertColor?: boolean }) {
  if (!variacao || variacao.variacaoPct === null) return null;
  const pct = variacao.variacaoPct;
  const isUp = pct > 0;
  const isFlat = pct === 0;
  const good = isFlat ? null : invertColor ? !isUp : isUp;
  const color = isFlat ? "text-muted-foreground" : good ? "text-green-500" : "text-red-500";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", color)}>
      {!isFlat && (isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      {isFlat ? "0%" : `${Math.abs(pct)}%`} vs mes passado
    </span>
  );
}

export function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/financeiro/overview")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-center text-muted-foreground py-12">
        Nao foi possivel carregar os dados financeiros.
      </p>
    );
  }

  const metaPct = data.meta.alvo > 0 ? Math.round((data.meta.atual / data.meta.alvo) * 100) : 0;
  const metaColor = metaPct >= 60 ? "bg-green-500" : metaPct >= 30 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Receitas</p>
                <p className="text-2xl font-bold text-green-500">{BRL.format(data.receitas)}</p>
                <VariacaoBadge variacao={data.comparativo?.receitas} />
              </div>
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Despesas</p>
                <p className="text-2xl font-bold text-red-500">{BRL.format(data.despesas)}</p>
                <VariacaoBadge variacao={data.comparativo?.despesas} invertColor />
              </div>
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saldo</p>
                <p className={cn("text-2xl font-bold", data.saldo >= 0 ? "text-blue-500" : "text-red-500")}>
                  {BRL.format(data.saldo)}
                </p>
                <VariacaoBadge variacao={data.comparativo?.saldo} />
              </div>
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                data.saldo >= 0 ? "bg-blue-500/10" : "bg-red-500/10"
              )}>
                <DollarSign className={cn("w-5 h-5", data.saldo >= 0 ? "text-blue-500" : "text-red-500")} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Meta progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Meta Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">
              {BRL.format(data.meta.atual)} de {BRL.format(data.meta.alvo)}
            </span>
            <span className="font-medium">{metaPct}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", metaColor)}
              style={{ width: `${Math.min(metaPct, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Receitas previstas */}
      {data.receitasPrevistas && data.receitasPrevistas.quantidade > 0 && (
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-muted-foreground" />
              Receitas Previstas
            </CardTitle>
            <span className="text-lg font-semibold text-green-500">
              {BRL.format(data.receitasPrevistas.total)}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.receitasPrevistas.proximas.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                <div className="min-w-0">
                  <span className="text-foreground">{r.descricao}</span>
                  {r.cliente && <span className="text-muted-foreground"> — {r.cliente}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn("text-xs", r.status === "atrasada" ? "text-red-500" : "text-muted-foreground")}>
                    {new Date(r.data_prevista).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="font-medium text-green-500">{BRL.format(r.valor)}</span>
                </div>
              </div>
            ))}
            {data.receitasPrevistas.quantidade > data.receitasPrevistas.proximas.length && (
              <p className="text-xs text-muted-foreground pt-1">
                +{data.receitasPrevistas.quantidade - data.receitasPrevistas.proximas.length} outra(s) na aba Receitas
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut - Top 8 categories */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categorias}
                    dataKey="total"
                    nameKey="categoria"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {data.categorias.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => BRL.format(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Bar chart - monthly comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Receitas vs Despesas (6 meses)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.mensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="mes"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => BRL.format(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="receitas" name="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
