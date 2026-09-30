"use client";

// Histórico: o livro-razão do financeiro. Toda criação, alteração e exclusão
// fica gravada aqui — nada se perde, e lançamentos excluídos podem ser restaurados.

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, ChevronDown, RotateCcw, Search, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BRL } from "./receitas-shared";

interface Item {
  id: string;
  entidade: string;
  entidade_id: string;
  acao: "criado" | "atualizado" | "excluido";
  criado_em: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  descricao: string | null;
  valor: number | null;
  restauravel: boolean;
}

const ENTIDADES: Record<string, string> = {
  Transacao: "Extrato",
  ReceitaPrevistaMax: "Receita prevista",
  ContaPagarMax: "Conta a pagar",
  DividaMax: "Dívida",
  OrcamentoMax: "Orçamento",
  MetaFinanceiraMax: "Meta",
  ContratoReceita: "Contrato de receita",
  FinancialTransaction: "Transação (financeiro)",
  RecurringBill: "Conta recorrente",
  InstallmentPlan: "Parcelamento",
  FinancialAccount: "Conta financeira",
};

const ACAO_LABEL = { criado: "Criado", atualizado: "Alterado", excluido: "Excluído" } as const;
const ACAO_COR = {
  criado: "bg-green-500/10 text-green-600",
  atualizado: "bg-blue-500/10 text-blue-600",
  excluido: "bg-red-500/10 text-red-600",
} as const;

const SEM_EXIBIR = new Set(["id", "criado_em"]);

function fmtValor(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function camposAlterados(it: Item): Array<{ campo: string; antes: unknown; depois: unknown }> {
  const a = it.antes ?? {};
  const d = it.depois ?? {};
  const chaves = Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).filter((k) => !SEM_EXIBIR.has(k));
  if (it.acao === "atualizado") {
    return chaves.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k])).map((k) => ({ campo: k, antes: a[k], depois: d[k] }));
  }
  const base = it.acao === "excluido" ? a : d;
  return chaves.filter((k) => base[k] != null).map((k) => ({ campo: k, antes: it.acao === "excluido" ? base[k] : null, depois: it.acao === "criado" ? base[k] : null }));
}

const selCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary";

export function HistoricoTab() {
  const [itens, setItens] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [entidades, setEntidades] = useState<string[]>([]);
  const [f, setF] = useState({ entidade: "", acao: "", de: "", ate: "", q: "" });
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setF((old) => (old.q === busca ? old : { ...old, q: busca })); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(pagina) });
      for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
      const r = await fetch(`/api/financeiro/historico?${q}`);
      const j = await r.json();
      setItens(j.itens ?? []);
      setTotal(j.total ?? 0);
      setPaginas(j.paginas ?? 1);
      setEntidades(j.entidades ?? []);
    } catch {
      setAviso({ ok: false, msg: "Não foi possível carregar o histórico." });
    } finally {
      setLoading(false);
    }
  }, [f, pagina]);

  useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setPagina(1); };

  const restaurar = async (it: Item) => {
    if (!confirm(`Restaurar "${it.descricao ?? it.entidade_id}"? O lançamento volta com os mesmos dados de antes da exclusão.`)) return;
    setRestaurando(it.id);
    const r = await fetch(`/api/financeiro/historico/${it.id}/restaurar`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setRestaurando(null);
    setAviso(r.ok ? { ok: true, msg: "Lançamento restaurado." } : { ok: false, msg: j.error ?? "Não foi possível restaurar." });
    void carregar();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-500" /> Histórico
        </h2>
        <p className="text-sm text-muted-foreground">
          Tudo que é lançado, alterado ou excluído no financeiro fica gravado aqui — inclusive o que o Max faz pelo WhatsApp. Nada é perdido.
        </p>
      </div>

      {aviso && (
        <div role="status" className={cn("rounded-lg border px-3 py-2 text-sm", aviso.ok ? "border-green-500/40 text-green-600" : "border-red-500/40 text-red-600")}>
          {aviso.msg} <button className="ml-2 underline" onClick={() => setAviso(null)}>ok</button>
        </div>
      )}

      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição ou id" className="pl-9 h-9" />
          </div>
          <select className={selCls} value={f.entidade} onChange={(e) => mudar({ entidade: e.target.value })} aria-label="Tipo de lançamento">
            <option value="">Todos os tipos</option>
            {entidades.map((e) => <option key={e} value={e}>{ENTIDADES[e] ?? e}</option>)}
          </select>
          <select className={selCls} value={f.acao} onChange={(e) => mudar({ acao: e.target.value })} aria-label="Ação">
            <option value="">Todas as ações</option>
            <option value="criado">Criados</option>
            <option value="atualizado">Alterados</option>
            <option value="excluido">Excluídos</option>
          </select>
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            De <input type="date" className={selCls} value={f.de} onChange={(e) => mudar({ de: e.target.value })} />
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            Até <input type="date" className={selCls} value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} />
          </label>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : itens.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhum registro no histórico com esses filtros.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {itens.map((it) => {
              const campos = aberto === it.id ? camposAlterados(it) : [];
              return (
                <li key={it.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setAberto(aberto === it.id ? null : it.id)} className="flex-1 min-w-0 flex items-center gap-3 text-left" aria-expanded={aberto === it.id}>
                      <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0", ACAO_COR[it.acao])}>{ACAO_LABEL[it.acao]}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-foreground truncate">{it.descricao ?? it.entidade_id}</span>
                        <span className="block text-xs text-muted-foreground">
                          {ENTIDADES[it.entidade] ?? it.entidade} · {new Date(it.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </span>
                      </span>
                      {it.valor != null && <span className="ml-auto text-sm font-medium text-foreground shrink-0">{BRL.format(it.valor)}</span>}
                      <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform", aberto !== it.id && "-rotate-90")} />
                    </button>
                    {it.restauravel && (
                      <Button size="sm" variant="outline" disabled={restaurando === it.id} onClick={() => void restaurar(it)} className="gap-1 shrink-0">
                        {restaurando === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Restaurar
                      </Button>
                    )}
                  </div>
                  {aberto === it.id && (
                    <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs overflow-x-auto">
                      <table className="w-full min-w-[420px]">
                        <thead>
                          <tr className="text-muted-foreground text-left">
                            <th className="font-medium py-1 pr-3">Campo</th>
                            {it.acao !== "criado" && <th className="font-medium py-1 pr-3">Antes</th>}
                            {it.acao !== "excluido" && <th className="font-medium py-1">Depois</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {campos.map((c) => (
                            <tr key={c.campo} className="border-t border-border/50">
                              <td className="py-1 pr-3 font-medium text-foreground">{c.campo}</td>
                              {it.acao !== "criado" && <td className="py-1 pr-3 text-muted-foreground">{fmtValor(c.antes)}</td>}
                              {it.acao !== "excluido" && <td className="py-1 text-foreground">{fmtValor(c.depois)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[10px] text-muted-foreground">id: {it.entidade_id}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
            <span>{total.toLocaleString("pt-BR")} registro(s)</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Página anterior"><ChevronLeft className="w-4 h-4" /></Button>
              <span>{pagina} / {paginas}</span>
              <Button variant="ghost" size="icon-sm" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Próxima página"><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
