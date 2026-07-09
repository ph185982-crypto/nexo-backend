"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertTriangle, TrendingDown, DollarSign, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot,
} from "recharts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface ProjecaoData {
  dias: Array<{ data: string; saldo: number; eventos: string[] }>;
  primeiro_negativo: string | null;
  saldo_atual: number;
  burn_rate: number;
}

export function ProjecaoTab() {
  const [data, setData] = useState<ProjecaoData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/financeiro/projecao")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-center text-muted-foreground py-12">
        Nao foi possivel carregar a projecao.
      </p>
    );
  }

  const chartData = data.dias.map((d) => ({
    ...d,
    dataLabel: new Date(d.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
  }));

  const negDay = data.primeiro_negativo
    ? chartData.find((d) => d.data === data.primeiro_negativo)
    : null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Projecao de Caixa (30 dias)</h2>

      {/* Chart */}
      <Card>
        <CardContent className="p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="50%" stopColor="#22c55e" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="dataLabel"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [BRL.format(value), "Saldo"]}
                  labelFormatter={(label) => `Data: ${label}`}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="saldo"
                  stroke="#22c55e"
                  fill="url(#saldoGradient)"
                  strokeWidth={2}
                />
                {negDay && (
                  <ReferenceDot
                    x={negDay.dataLabel}
                    y={negDay.saldo}
                    r={6}
                    fill="#ef4444"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Saldo Atual</p>
                <p className={cn(
                  "text-xl font-bold",
                  data.saldo_atual >= 0 ? "text-green-500" : "text-red-500"
                )}>
                  {BRL.format(data.saldo_atual)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Burn Rate Diario</p>
                <p className="text-xl font-bold text-orange-500">
                  {BRL.format(data.burn_rate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(data.primeiro_negativo && "border-red-500/50")}>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                data.primeiro_negativo ? "bg-red-500/10" : "bg-green-500/10"
              )}>
                {data.primeiro_negativo
                  ? <AlertTriangle className="w-5 h-5 text-red-500" />
                  : <Calendar className="w-5 h-5 text-green-500" />
                }
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Primeiro Dia Negativo</p>
                {data.primeiro_negativo ? (
                  <p className="text-xl font-bold text-red-500">
                    {new Date(data.primeiro_negativo).toLocaleDateString("pt-BR")}
                  </p>
                ) : (
                  <p className="text-xl font-bold text-green-500">Nenhum</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
