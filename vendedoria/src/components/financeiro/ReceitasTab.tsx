"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Receita {
  id: string;
  descricao: string;
  valor: number;
  data_prevista: string;
  cliente: string;
  status: "pendente" | "atrasada" | "recebida";
}

function statusBadge(status: string) {
  switch (status) {
    case "recebida": return <Badge variant="success">Recebida</Badge>;
    case "atrasada": return <Badge variant="destructive">Atrasada</Badge>;
    default: return <Badge variant="warning">Pendente</Badge>;
  }
}

export function ReceitasTab() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ descricao: "", valor: "", data_prevista: "", cliente: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchReceitas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/receitas");
      const json = await res.json();
      setReceitas(json.receitas ?? json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReceitas(); }, [fetchReceitas]);

  const confirmarRecebimento = async (id: string) => {
    await fetch(`/api/financeiro/receitas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "recebida" }),
    });
    fetchReceitas();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/financeiro/receitas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: form.descricao,
          valor: parseFloat(form.valor),
          data_prevista: form.data_prevista,
          cliente: form.cliente,
        }),
      });
      setForm({ descricao: "", valor: "", data_prevista: "", cliente: "" });
      setShowForm(false);
      fetchReceitas();
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
        <h2 className="text-lg font-semibold text-foreground">Receitas Previstas</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancelar" : "Nova receita"}
        </Button>
      </div>

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
                value={form.data_prevista}
                onChange={(e) => setForm({ ...form, data_prevista: e.target.value })}
                required
              />
              <Input
                placeholder="Cliente"
                value={form.cliente}
                onChange={(e) => setForm({ ...form, cliente: e.target.value })}
              />
              <Button type="submit" disabled={submitting} className="gap-1">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {receitas.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhuma receita registrada.</p>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-muted-foreground">Descricao</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Valor</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Data Prevista</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Cliente</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                  <th className="p-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {receitas.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="p-3 text-foreground">{r.descricao}</td>
                    <td className="p-3 text-right font-medium text-green-500 whitespace-nowrap">
                      {BRL.format(r.valor)}
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {new Date(r.data_prevista).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.cliente || "-"}</td>
                    <td className="p-3">{statusBadge(r.status)}</td>
                    <td className="p-3">
                      {(r.status === "pendente" || r.status === "atrasada") && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => confirmarRecebimento(r.id)}
                          title="Confirmar recebimento"
                        >
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
