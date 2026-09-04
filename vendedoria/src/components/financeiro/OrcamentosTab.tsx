"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Orcamento {
  id: string;
  categoria: string;
  limite_mensal: number;
  gasto_atual: number;
}

export function OrcamentosTab() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ categoria: "", limite_mensal: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchOrcamentos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/orcamentos");
      const json = await res.json();
      setOrcamentos(json.orcamentos ?? json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrcamentos(); }, [fetchOrcamentos]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/financeiro/orcamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoria: form.categoria,
          limite_mensal: parseFloat(form.limite_mensal),
        }),
      });
      setForm({ categoria: "", limite_mensal: "" });
      setShowForm(false);
      fetchOrcamentos();
    } finally {
      setSubmitting(false);
    }
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Orcamentos</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancelar" : "Definir orcamento"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Categoria"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                required
                className="flex-1"
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Limite mensal (R$)"
                value={form.limite_mensal}
                onChange={(e) => setForm({ ...form, limite_mensal: e.target.value })}
                required
                className="w-full sm:w-48"
              />
              <Button type="submit" disabled={submitting} className="gap-1 shrink-0">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {orcamentos.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhum orcamento definido.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {orcamentos.map((o) => {
                const pct = o.limite_mensal > 0 ? Math.round((o.gasto_atual / o.limite_mensal) * 100) : 0;
                const barColor = pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500";
                return (
                  <div key={o.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{o.categoria}</span>
                      <span className={cn(
                        "text-sm font-medium",
                        pct > 100 ? "text-red-500" : pct >= 80 ? "text-yellow-500" : "text-green-500"
                      )}>
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Gasto: {BRL.format(o.gasto_atual)}</span>
                      <span>Limite: {BRL.format(o.limite_mensal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
