"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Conta {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  categoria: string;
  status: "pendente" | "paga" | "vencida";
}

export function ContasTab() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ descricao: "", valor: "", vencimento: "", categoria: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchContas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/contas?status=pendente");
      const json = await res.json();
      setContas(json.contas ?? json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContas(); }, [fetchContas]);

  const marcarComoPaga = async (id: string) => {
    await fetch(`/api/financeiro/contas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paga" }),
    });
    fetchContas();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/financeiro/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: form.descricao,
          valor: parseFloat(form.valor),
          vencimento: form.vencimento,
          categoria: form.categoria,
        }),
      });
      setForm({ descricao: "", valor: "", vencimento: "", categoria: "" });
      setShowForm(false);
      fetchContas();
    } finally {
      setSubmitting(false);
    }
  };

  const isOverdue = (vencimento: string) => new Date(vencimento) < new Date();

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
        <h2 className="text-lg font-semibold text-foreground">Contas a Pagar</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancelar" : "Nova conta"}
        </Button>
      </div>

      {/* New bill form */}
      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <Input
                placeholder="Descricao"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                required
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Valor"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                required
              />
              <Input
                type="date"
                value={form.vencimento}
                onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
                required
              />
              <Input
                placeholder="Categoria"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              />
              <Button type="submit" disabled={submitting} className="gap-1">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Bills list */}
      {contas.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhuma conta pendente.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contas.map((conta) => {
            const overdue = conta.status === "pendente" && isOverdue(conta.vencimento);
            return (
              <Card key={conta.id} className={cn(overdue && "border-red-500/50")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">{conta.descricao}</h3>
                        {overdue && (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertTriangle className="w-3 h-3" /> Vencida
                          </Badge>
                        )}
                        {conta.status === "paga" && (
                          <Badge variant="success">Paga</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">{BRL.format(conta.valor)}</span>
                        <span>Vence: {new Date(conta.vencimento).toLocaleDateString("pt-BR")}</span>
                        {conta.categoria && <span>{conta.categoria}</span>}
                      </div>
                    </div>
                    {conta.status === "pendente" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => marcarComoPaga(conta.id)}
                        className="gap-1 shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Paga
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
