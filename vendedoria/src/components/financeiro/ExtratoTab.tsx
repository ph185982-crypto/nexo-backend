"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Trash2, Search, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Transacao {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  tipo: "receita" | "despesa";
  valor: number;
  tipo_negocio?: string;
}

interface TransacoesResponse {
  transacoes: Transacao[];
  total: number;
  paginas: number;
  pagina: number;
  categorias?: string[];
  tipos_negocio?: string[];
}

export function ExtratoTab() {
  const [data, setData] = useState<TransacoesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipoNegocio, setTipoNegocio] = useState("");
  const [texto, setTexto] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ descricao: "", valor: "", categoria: "", tipo: "" as string });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        tipo, categoria, tipo_negocio: tipoNegocio, texto,
        data_inicio: dataInicio, data_fim: dataFim,
      });
      const res = await fetch(`/api/financeiro/transacoes?${params}`);
      const json = await res.json();
      setData(json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [page, tipo, categoria, tipoNegocio, texto, dataInicio, dataFim]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Tem certeza que deseja excluir esta transacao?")) return;
    await fetch(`/api/financeiro/transacoes/${id}`, { method: "DELETE" });
    fetchData();
  };

  const startEdit = (t: Transacao) => {
    setEditingId(t.id);
    setEditForm({
      descricao: t.descricao,
      valor: String(t.valor),
      categoria: t.categoria,
      tipo: t.tipo,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await fetch(`/api/financeiro/transacoes/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao: editForm.descricao,
        valor: parseFloat(editForm.valor),
        categoria: editForm.categoria,
        tipo: editForm.tipo,
      }),
    });
    setEditingId(null);
    fetchData();
  };

  const resetFilters = () => {
    setTipo(""); setCategoria(""); setTipoNegocio("");
    setTexto(""); setDataInicio(""); setDataFim("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={texto}
                onChange={(e) => { setTexto(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <select
              value={tipo}
              onChange={(e) => { setTipo(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Todos os tipos</option>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
            </select>
            <select
              value={categoria}
              onChange={(e) => { setCategoria(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Todas as categorias</option>
              {(data?.categorias ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={tipoNegocio}
              onChange={(e) => { setTipoNegocio(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Todos os negocios</option>
              {(data?.tipos_negocio ?? []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <Input
              type="date"
              value={dataInicio}
              onChange={(e) => { setDataInicio(e.target.value); setPage(1); }}
              placeholder="Data inicio"
            />
            <Input
              type="date"
              value={dataFim}
              onChange={(e) => { setDataFim(e.target.value); setPage(1); }}
              placeholder="Data fim"
            />
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
              <X className="w-3 h-3" /> Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-muted-foreground">Data</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Descricao</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Categoria</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Negocio</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Valor</th>
                  <th className="p-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {(data?.transacoes ?? []).map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                    {editingId === t.id ? (
                      <>
                        <td className="p-3 text-muted-foreground">
                          {new Date(t.data).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="p-3">
                          <Input
                            value={editForm.descricao}
                            onChange={(e) => setEditForm({ ...editForm, descricao: e.target.value })}
                            className="h-7 text-sm"
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            value={editForm.categoria}
                            onChange={(e) => setEditForm({ ...editForm, categoria: e.target.value })}
                            className="h-7 text-sm"
                          />
                        </td>
                        <td className="p-3 text-muted-foreground">{t.tipo_negocio ?? "-"}</td>
                        <td className="p-3 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.valor}
                            onChange={(e) => setEditForm({ ...editForm, valor: e.target.value })}
                            className="h-7 text-sm text-right w-28 ml-auto"
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon-sm" onClick={saveEdit}>
                              <Check className="w-3.5 h-3.5 text-green-500" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => setEditingId(null)}>
                              <X className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {new Date(t.data).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="p-3 text-foreground">{t.descricao}</td>
                        <td className="p-3 text-muted-foreground">{t.categoria}</td>
                        <td className="p-3 text-muted-foreground">{t.tipo_negocio ?? "-"}</td>
                        <td className={cn(
                          "p-3 text-right font-medium whitespace-nowrap",
                          t.tipo === "receita" ? "text-green-500" : "text-red-500"
                        )}>
                          {t.tipo === "despesa" ? "- " : ""}{BRL.format(t.valor)}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon-sm" onClick={() => startEdit(t)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(t.id)}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {(data?.transacoes ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      Nenhuma transacao encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {data && data.paginas > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Pagina {data.pagina} de {data.paginas} ({data.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.paginas}
              onClick={() => setPage((p) => p + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
