"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Divida {
  id: string;
  credor: string;
  valor_total: number;
  valor_pago: number;
  parcela_mensal: number;
  dia_vencimento: number;
}

export function DividasTab() {
  const [dividas, setDividas] = useState<Divida[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payValue, setPayValue] = useState("");

  const fetchDividas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/dividas");
      const json = await res.json();
      setDividas(json.dividas ?? json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDividas(); }, [fetchDividas]);

  const pagarParcela = async (id: string) => {
    const valor = parseFloat(payValue);
    if (isNaN(valor) || valor <= 0) return;
    await fetch(`/api/financeiro/dividas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "pagar_parcela", valor }),
    });
    setPayingId(null);
    setPayValue("");
    fetchDividas();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Dividas</h2>

      {dividas.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhuma divida registrada.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dividas.map((d) => {
            const pct = d.valor_total > 0 ? Math.round((d.valor_pago / d.valor_total) * 100) : 0;
            const restante = d.valor_total - d.valor_pago;
            return (
              <Card key={d.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-foreground">{d.credor}</h3>
                    <span className="text-sm text-muted-foreground">Dia {d.dia_vencimento}</span>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">
                        {BRL.format(d.valor_pago)} de {BRL.format(d.valor_total)}
                      </span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>Parcela: {BRL.format(d.parcela_mensal)}</span>
                    <span>Restante: {BRL.format(restante)}</span>
                  </div>

                  {/* Pay action */}
                  {payingId === d.id ? (
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Valor"
                        value={payValue}
                        onChange={(e) => setPayValue(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => pagarParcela(d.id)} className="shrink-0">
                        Confirmar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setPayingId(null); setPayValue(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setPayingId(d.id); setPayValue(String(d.parcela_mensal)); }}
                      className="gap-1"
                    >
                      <CreditCard className="w-3.5 h-3.5" /> Pagar parcela
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
