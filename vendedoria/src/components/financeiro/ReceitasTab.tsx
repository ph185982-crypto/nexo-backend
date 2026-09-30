"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Plus, CheckCircle2, X, ThumbsDown, Undo2, Repeat, CalendarClock, Layers, FileText, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TIPO_NEGOCIO_OPTIONS, formatTipoNegocio } from "@/lib/finance/labels";
import { gerarParcelas } from "@/lib/finance/parcelas";
import {
  BRL, fmtData, ParcelaChip, PerdaDialog, StatusReceitaBadge, executarAcaoReceita, type ReceitaItem,
} from "./receitas-shared";
import { FiltroPeriodo, filtroInicial, filtroParaQuery, hojeBR, type FiltroFin } from "./FiltroPeriodo";

type StatusFiltro = "todas" | "abertas" | "atrasada" | "recebida" | "perdida";

interface Totais {
  abertas: { quantidade: number; total: number };
  atrasadas: { quantidade: number; total: number };
  recebidas: { quantidade: number; total: number };
  perdidas: { quantidade: number; total: number };
}

interface ContratoItem {
  id: string;
  descricao: string;
  cliente: string | null;
  tipo_negocio: string;
  modo: "recorrente" | "parcelada";
  valor_parcela: number;
  valor_total: number | null;
  duracao_meses: number | null;
  dia_vencimento: number;
  data_inicio: string;
  status: string;
  parcelas: {
    recebidas: { quantidade: number; total: number };
    abertas: { quantidade: number; total: number };
    perdidas: { quantidade: number; total: number };
  };
}

const STATUS_CHIPS: Array<{ v: StatusFiltro; label: string }> = [
  { v: "todas", label: "Todas" },
  { v: "abertas", label: "Em aberto" },
  { v: "atrasada", label: "Atrasadas" },
  { v: "recebida", label: "Recebidas" },
  { v: "perdida", label: "Perdidas" },
];

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary";

export function ReceitasTab() {
  const [filtro, setFiltro] = useState<FiltroFin>(filtroInicial);
  const [status, setStatus] = useState<StatusFiltro>("todas");
  const [receitas, setReceitas] = useState<ReceitaItem[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [contratos, setContratos] = useState<ContratoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [perda, setPerda] = useState<ReceitaItem | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mostrarContratos, setMostrarContratos] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const q = filtroParaQuery(filtro);
      if (status !== "todas") q.set("status", status);
      const [rRes, cRes] = await Promise.all([
        fetch(`/api/financeiro/receitas?${q}`),
        fetch("/api/financeiro/contratos"),
      ]);
      const r = await rRes.json();
      const c = await cRes.json();
      setReceitas(r.receitas ?? []);
      setTotais(r.totais ?? null);
      setContratos(c.contratos ?? []);
    } catch {
      setAviso({ tipo: "erro", msg: "Não foi possível carregar as receitas." });
    } finally {
      setLoading(false);
    }
  }, [filtro, status]);

  useEffect(() => { void carregar(); }, [carregar]);

  const agir = async (id: string, acao: "confirmar" | "reverter_perda") => {
    setOcupado(id);
    const r = await executarAcaoReceita(id, acao);
    setOcupado(null);
    if (!r.ok) setAviso({ tipo: "erro", msg: r.erro ?? "Erro ao atualizar." });
    else setAviso({ tipo: "ok", msg: acao === "confirmar" ? "Recebimento confirmado e lançado no extrato." : "Perda desfeita — a receita voltou para pendente." });
    void carregar();
  };

  const encerrar = async (c: ContratoItem) => {
    if (!confirm(`Encerrar o contrato "${c.descricao}"? As parcelas futuras ainda pendentes viram perda (ficam gravadas e dá para desfazer uma a uma).`)) return;
    setOcupado(c.id);
    const res = await fetch(`/api/financeiro/contratos/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "encerrar" }),
    });
    setOcupado(null);
    const j = await res.json().catch(() => ({}));
    setAviso(res.ok
      ? { tipo: "ok", msg: `Contrato encerrado — ${j.parcelasPerdidas ?? 0} parcela(s) futura(s) viraram perda.` }
      : { tipo: "erro", msg: j.error ?? "Erro ao encerrar o contrato." });
    void carregar();
  };

  const contratosAtivos = contratos.filter((c) => c.status === "ativo");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Receitas</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancelar" : "Nova receita"}
        </Button>
      </div>

      {aviso && (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
            aviso.tipo === "ok" ? "border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-400" : "border-red-500/40 bg-red-500/5 text-red-600",
          )}
        >
          <span>{aviso.msg}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}

      {showForm && (
        <NovaReceitaForm
          onCriada={(msg) => { setShowForm(false); setAviso({ tipo: "ok", msg }); void carregar(); }}
          onErro={(msg) => setAviso({ tipo: "erro", msg })}
        />
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <FiltroPeriodo filtro={filtro} onChange={setFiltro} permitirTodos />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.v}
                onClick={() => setStatus(c.v)}
                aria-pressed={status === c.v}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  status === c.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Totais do filtro */}
      {totais && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Resumo titulo="Em aberto" v={totais.abertas} cor="text-orange-500" />
          <Resumo titulo="Atrasadas" v={totais.atrasadas} cor="text-red-500" />
          <Resumo titulo="Recebidas" v={totais.recebidas} cor="text-green-500" />
          <Resumo titulo="Perdidas" v={totais.perdidas} cor="text-muted-foreground" />
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : receitas.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhuma receita neste filtro.</p>
      ) : (
        <>
        {/* Celular: cartões, com as ações sempre à vista */}
        <div className="md:hidden space-y-2">
          {receitas.map((r) => (
            <Card key={r.id} className={cn(r.status === "perdida" && "opacity-70")}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium text-foreground", r.status === "perdida" && "line-through decoration-muted-foreground/50")}>
                      {r.descricao}<ParcelaChip r={r} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.cliente ? `${r.cliente} · ` : ""}{formatTipoNegocio(r.tipo_negocio ?? "pessoal")} · {fmtData(r.data_prevista)}
                    </p>
                    {r.motivo_perda && r.status === "perdida" && <p className="text-xs text-muted-foreground">Motivo: {r.motivo_perda}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-green-500">{BRL.format(r.valor)}</p>
                    <StatusReceitaBadge r={r} />
                  </div>
                </div>
                {(r.status !== "recebida") && (
                  <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
                    <AcoesReceita r={r} ocupado={ocupado === r.id} onAgir={(id, a) => void agir(id, a)} onPerda={setPerda} rotulos />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-muted-foreground">Descrição</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Valor</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Data prevista</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Cliente</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Negócio</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {receitas.map((r) => {
                  return (
                    <tr key={r.id} className={cn("border-b border-border last:border-0 hover:bg-muted/50 transition-colors", r.status === "perdida" && "opacity-70")}>
                      <td className="p-3 text-foreground">
                        <span className={cn(r.status === "perdida" && "line-through decoration-muted-foreground/50")}>{r.descricao}</span>
                        <ParcelaChip r={r} />
                        {r.motivo_perda && r.status === "perdida" && (
                          <div className="text-xs text-muted-foreground">Motivo: {r.motivo_perda}</div>
                        )}
                      </td>
                      <td className="p-3 text-right font-medium text-green-500 whitespace-nowrap">{BRL.format(r.valor)}</td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtData(r.data_prevista)}</td>
                      <td className="p-3 text-muted-foreground">{r.cliente || "-"}</td>
                      <td className="p-3 text-muted-foreground">{formatTipoNegocio(r.tipo_negocio ?? "pessoal")}</td>
                      <td className="p-3"><StatusReceitaBadge r={r} /></td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <AcoesReceita r={r} ocupado={ocupado === r.id} onAgir={(id, a) => void agir(id, a)} onPerda={setPerda} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      )}

      {/* Contratos */}
      {contratos.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setMostrarContratos(!mostrarContratos)} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Contratos e parcelamentos ({contratosAtivos.length} ativo{contratosAtivos.length === 1 ? "" : "s"})
            <ChevronDown className={cn("w-4 h-4 transition-transform", !mostrarContratos && "-rotate-90")} />
          </button>
          {mostrarContratos && (
            <div className="grid gap-3 md:grid-cols-2">
              {contratos.map((c) => {
                const total = c.parcelas.recebidas.quantidade + c.parcelas.abertas.quantidade + c.parcelas.perdidas.quantidade;
                const pct = total ? Math.round((c.parcelas.recebidas.quantidade / total) * 100) : 0;
                return (
                  <Card key={c.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{c.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.cliente ? `${c.cliente} · ` : ""}{formatTipoNegocio(c.tipo_negocio)} ·{" "}
                            {c.modo === "parcelada" ? "Parcelado" : "Recorrente"} ·{" "}
                            {c.duracao_meses ? `${c.duracao_meses} meses` : "prazo indeterminado"}
                          </p>
                        </div>
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", c.status === "ativo" ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground")}>
                          {c.status === "ativo" ? "Ativo" : "Encerrado"}
                        </span>
                      </div>
                      <p className="text-sm">
                        <span className="font-semibold text-green-500">{BRL.format(c.valor_parcela)}</span>
                        <span className="text-muted-foreground"> / mês · vence dia {c.dia_vencimento}</span>
                        {c.valor_total ? <span className="text-muted-foreground"> · total {BRL.format(c.valor_total)}</span> : null}
                      </p>
                      <div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${pct}%` }} /></div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {c.parcelas.recebidas.quantidade} recebida(s) ({BRL.format(c.parcelas.recebidas.total)}) ·{" "}
                          {c.parcelas.abertas.quantidade} em aberto ({BRL.format(c.parcelas.abertas.total)})
                          {c.parcelas.perdidas.quantidade > 0 && <> · {c.parcelas.perdidas.quantidade} perdida(s)</>}
                        </p>
                      </div>
                      {c.status === "ativo" && (
                        <Button variant="outline" size="sm" disabled={ocupado === c.id} onClick={() => void encerrar(c)} className="gap-1 text-red-500">
                          <ThumbsDown className="w-3.5 h-3.5" /> Encerrar contrato
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PerdaDialog
        receita={perda}
        onClose={() => setPerda(null)}
        onDone={() => { setAviso({ tipo: "ok", msg: "Perda registrada. A receita continua no histórico e pode ser desfeita." }); void carregar(); }}
      />
    </div>
  );
}

function AcoesReceita({ r, ocupado, onAgir, onPerda, rotulos }: {
  r: ReceitaItem; ocupado: boolean;
  onAgir: (id: string, acao: "confirmar" | "reverter_perda") => void;
  onPerda: (r: ReceitaItem) => void;
  rotulos?: boolean;
}) {
  const aberta = r.status === "pendente" || r.status === "atrasada";
  return (
    <>
      {aberta && (
        <>
          <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => onAgir(r.id, "confirmar")} title="Confirmar recebimento" className="gap-1 text-green-600 hover:text-green-600">
            <CheckCircle2 className="w-4 h-4" /> <span className={rotulos ? "" : "hidden xl:inline"}>Receber</span>
          </Button>
          <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => onPerda(r)} title="Dar perda nesta receita" className="gap-1 text-red-500 hover:text-red-500">
            <ThumbsDown className="w-4 h-4" /> Perda
          </Button>
        </>
      )}
      {r.status === "perdida" && (
        <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => onAgir(r.id, "reverter_perda")} title="Desfazer a perda" className="gap-1">
          <Undo2 className="w-4 h-4" /> Desfazer
        </Button>
      )}
    </>
  );
}

function Resumo({ titulo, v, cor }: { titulo: string; v: { quantidade: number; total: number }; cor: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={cn("text-lg font-semibold", cor)}>{BRL.format(v.total)}</p>
        <p className="text-[11px] text-muted-foreground">{v.quantidade} lançamento(s)</p>
      </CardContent>
    </Card>
  );
}

// ─── Formulário ────────────────────────────────────────────────────────────────

type Modo = "avulsa" | "parcelada" | "recorrente";

const MODOS: Array<{ v: Modo; label: string; desc: string; icon: React.ReactNode }> = [
  { v: "avulsa", label: "Avulsa", desc: "Um único recebimento", icon: <CalendarClock className="w-4 h-4" /> },
  { v: "parcelada", label: "Parcelada", desc: "Total dividido em meses", icon: <Layers className="w-4 h-4" /> },
  { v: "recorrente", label: "Contrato recorrente", desc: "Mensalidade por X meses", icon: <Repeat className="w-4 h-4" /> },
];

const DURACOES = [3, 6, 12, 18, 24, 36];

function num(s: string): number | undefined {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function NovaReceitaForm({ onCriada, onErro }: { onCriada: (msg: string) => void; onErro: (msg: string) => void }) {
  const [modo, setModo] = useState<Modo>("avulsa");
  const [f, setF] = useState({
    descricao: "", cliente: "", tipo_negocio: "nexo", observacao: "",
    valor: "", valor_total: "", valor_parcela: "", meses: "12",
    duracao: "12" as string, // "12" | "custom" | "indeterminado"
    primeiro: hojeBR(),
  });
  const [salvando, setSalvando] = useState(false);

  const set = (p: Partial<typeof f>) => setF((old) => ({ ...old, ...p }));

  // Duração efetiva em meses (null = indeterminado, só recorrente)
  const mesesEfetivos: number | null =
    modo === "parcelada" ? (parseInt(f.meses, 10) || 0)
    : f.duracao === "indeterminado" ? null
    : f.duracao === "custom" ? (parseInt(f.meses, 10) || 0)
    : parseInt(f.duracao, 10);

  // Parcelada: total ⇄ parcela se calculam um a partir do outro
  const editarTotal = (v: string) => {
    const m = parseInt(f.meses, 10);
    const t = num(v);
    set({ valor_total: v, valor_parcela: t && m > 0 ? (Math.round((t / m) * 100) / 100).toFixed(2) : "" });
  };
  const editarParcela = (v: string) => {
    const m = parseInt(f.meses, 10);
    const p = num(v);
    set({ valor_parcela: v, valor_total: p && m > 0 ? (Math.round(p * m * 100) / 100).toFixed(2) : "" });
  };
  const editarMeses = (v: string) => {
    const m = parseInt(v, 10);
    const t = num(f.valor_total);
    set({ meses: v, valor_parcela: t && m > 0 ? (Math.round((t / m) * 100) / 100).toFixed(2) : f.valor_parcela });
  };

  const previa = useMemo(() => {
    if (modo === "avulsa") return { erro: null, parcelas: [] as ReturnType<typeof gerarParcelas> };
    try {
      const meses = mesesEfetivos ?? 12;
      const parcelas = gerarParcelas({
        primeiroVencimento: f.primeiro,
        meses,
        ...(modo === "parcelada" ? { valorTotal: num(f.valor_total) } : { valorParcela: num(f.valor_parcela) }),
      });
      return { erro: null, parcelas };
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "Dados inválidos", parcelas: [] };
    }
  }, [modo, mesesEfetivos, f.primeiro, f.valor_total, f.valor_parcela]);

  const totalPrevia = previa.parcelas.reduce((s, p) => s + p.valor, 0);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modo !== "avulsa" && previa.erro) { onErro(previa.erro); return; }
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = {
        modo,
        descricao: f.descricao,
        cliente: f.cliente || null,
        tipo_negocio: f.tipo_negocio,
        observacao: f.observacao || null,
        data_prevista: f.primeiro,
      };
      if (modo === "avulsa") corpo.valor = num(f.valor);
      if (modo === "parcelada") { corpo.valor_total = num(f.valor_total); corpo.meses = mesesEfetivos; }
      if (modo === "recorrente") { corpo.valor_parcela = num(f.valor_parcela); corpo.meses = mesesEfetivos; }

      const res = await fetch("/api/financeiro/receitas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onErro(j.error ?? "Não foi possível salvar."); return; }
      onCriada(
        modo === "avulsa"
          ? "Receita registrada."
          : `Contrato criado — ${j.parcelas} parcela(s) geradas automaticamente${mesesEfetivos == null ? " (e o sistema segue gerando os meses seguintes)" : ""}.`,
      );
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setModo(m.v)}
              aria-pressed={modo === m.v}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                modo === m.v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
              )}
            >
              <span className={cn("shrink-0", modo === m.v ? "text-primary" : "text-muted-foreground")}>{m.icon}</span>
              <span>
                <span className="block text-sm font-medium text-foreground">{m.label}</span>
                <span className="block text-[11px] text-muted-foreground">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <form onSubmit={enviar} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Campo label="Descrição">
              <Input value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} placeholder={modo === "avulsa" ? "Ex.: Consultoria pontual" : "Ex.: Assessoria mensal"} required />
            </Campo>
            <Campo label="Cliente">
              <Input value={f.cliente} onChange={(e) => set({ cliente: e.target.value })} placeholder="Nome do cliente" />
            </Campo>
            <Campo label="Negócio">
              <select value={f.tipo_negocio} onChange={(e) => set({ tipo_negocio: e.target.value })} className={inputCls}>
                {TIPO_NEGOCIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Campo>

            {modo === "avulsa" && (
              <>
                <Campo label="Valor (R$)">
                  <Input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => set({ valor: e.target.value })} required />
                </Campo>
                <Campo label="Data prevista">
                  <Input type="date" value={f.primeiro} onChange={(e) => set({ primeiro: e.target.value })} required />
                </Campo>
              </>
            )}

            {modo === "parcelada" && (
              <>
                <Campo label="Valor total (R$)">
                  <Input type="number" step="0.01" min="0" value={f.valor_total} onChange={(e) => editarTotal(e.target.value)} required />
                </Campo>
                <Campo label="Nº de parcelas (meses)">
                  <Input type="number" min="1" max="120" value={f.meses} onChange={(e) => editarMeses(e.target.value)} required />
                </Campo>
                <Campo label="Valor da parcela (R$)">
                  <Input type="number" step="0.01" min="0" value={f.valor_parcela} onChange={(e) => editarParcela(e.target.value)} />
                </Campo>
                <Campo label="1º vencimento">
                  <Input type="date" value={f.primeiro} onChange={(e) => set({ primeiro: e.target.value })} required />
                </Campo>
              </>
            )}

            {modo === "recorrente" && (
              <>
                <Campo label="Valor mensal (R$)">
                  <Input type="number" step="0.01" min="0" value={f.valor_parcela} onChange={(e) => set({ valor_parcela: e.target.value })} required />
                </Campo>
                <Campo label="Duração do contrato">
                  <select value={f.duracao} onChange={(e) => set({ duracao: e.target.value })} className={inputCls}>
                    {DURACOES.map((d) => <option key={d} value={String(d)}>{d} meses</option>)}
                    <option value="custom">Outro prazo…</option>
                    <option value="indeterminado">Indeterminado (mensalidade contínua)</option>
                  </select>
                </Campo>
                {f.duracao === "custom" && (
                  <Campo label="Quantos meses">
                    <Input type="number" min="1" max="120" value={f.meses} onChange={(e) => set({ meses: e.target.value })} required />
                  </Campo>
                )}
                <Campo label="1º vencimento">
                  <Input type="date" value={f.primeiro} onChange={(e) => set({ primeiro: e.target.value })} required />
                </Campo>
              </>
            )}

            <Campo label="Observação (opcional)">
              <Input value={f.observacao} onChange={(e) => set({ observacao: e.target.value })} />
            </Campo>
          </div>

          {/* Prévia automática das parcelas */}
          {modo !== "avulsa" && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              {previa.erro ? (
                <p className="text-sm text-muted-foreground">Preencha os campos para ver as parcelas geradas automaticamente. <span className="text-xs">({previa.erro})</span></p>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground mb-2">
                    {previa.parcelas.length} parcela(s) serão geradas
                    {mesesEfetivos == null && " — depois o sistema continua gerando mês a mês, sempre 12 meses à frente"} ·{" "}
                    <span className="text-green-500">{BRL.format(totalPrevia)}</span>
                    {mesesEfetivos == null && " nos primeiros 12 meses"}
                  </p>
                  <div className="max-h-44 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {previa.parcelas.map((p) => (
                      <div key={p.numero} className="flex justify-between gap-2 border-b border-border/50 py-0.5">
                        <span>{p.numero}ª · {p.data.split("-").reverse().join("/")}</span>
                        <span className="text-foreground">{BRL.format(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={salvando} className="gap-1">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              {modo === "avulsa" ? "Salvar receita" : "Criar e gerar parcelas"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
