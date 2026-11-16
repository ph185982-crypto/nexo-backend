"use client";

// Metas de poupança: progresso até o prazo, valor do dia, projeção e registro de
// aportes. O Max cobra o valor diário pelo WhatsApp; aqui o dono vê e ajusta.

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, PiggyBank, Trash2, Pencil, Check, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inputCls, parseValor, fmtInput, patch } from "./EditarDialogs";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

interface Meta {
  id: string;
  descricao: string;
  alvo: number;
  atual: number;
  aporteDiario: number;
  cobrarDiariamente: boolean;
  chavePix: string | null;
  dataInicio: string;
  dataFim: string;
  projecao: {
    falta: number;
    pct: number;
    diasRestantes: number;
    pendenteHoje: number;
    atraso: number;
    projetadoNoPrazo: number;
    necessarioPorDia: number;
    vaiBater: boolean;
    concluida: boolean;
  };
  ultimosAportes: Array<{ id: string; valor: number; data: string; origem: string; observacao: string | null }>;
}

export function MetasPoupancaPanel() {
  const [metas, setMetas] = useState<Meta[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/financeiro/metas-poupanca", { cache: "no-store" });
      if (r.ok) setMetas(await r.json());
      else setMetas([]);
    } catch {
      setMetas([]);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  if (metas === null) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (metas.length === 0) return null;

  return (
    <div className="space-y-3">
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
      {metas.map((m) => (
        <MetaCard key={m.id} meta={m} onMudou={(msg) => { setAviso(msg); void carregar(); }} />
      ))}
    </div>
  );
}

function MetaCard({ meta: m, onMudou }: { meta: Meta; onMudou: (msg: string) => void }) {
  const p = m.projecao;
  const [valor, setValor] = useState(fmtInput(p.pendenteHoje || m.aporteDiario));
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [diario, setDiario] = useState(fmtInput(m.aporteDiario));
  const [alvo, setAlvo] = useState(fmtInput(m.alvo));
  const [prazo, setPrazo] = useState(m.dataFim);
  const [pix, setPix] = useState(m.chavePix ?? "");

  const copiar = async (texto: string, oQue: string) => {
    try { await navigator.clipboard.writeText(texto); onMudou(`${oQue} copiad${oQue.endsWith("a") ? "a" : "o"}.`); } catch { onMudou("Não foi possível copiar."); }
  };

  useEffect(() => { setValor(fmtInput(p.pendenteHoje || m.aporteDiario)); }, [p.pendenteHoje, m.aporteDiario]);

  const aportar = async (sinal: 1 | -1) => {
    const v = parseValor(valor);
    if (!(v > 0)) { onMudou("Informe um valor válido."); return; }
    setOcupado(true);
    const r = await fetch("/api/financeiro/metas-poupanca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta_id: m.id, valor: sinal * v }),
    }).catch(() => null);
    setOcupado(false);
    onMudou(r?.ok ? (sinal > 0 ? `${BRL.format(v)} guardados na meta.` : `Retirada de ${BRL.format(v)} registrada.`) : "Não foi possível registrar.");
  };

  const excluir = async (id: string) => {
    if (!confirm("Excluir este aporte?")) return;
    const r = await fetch(`/api/financeiro/metas-poupanca?aporte_id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    onMudou(r?.ok ? "Aporte excluído." : "Não foi possível excluir.");
  };

  const salvar = async () => {
    const d = parseValor(diario);
    const a = parseValor(alvo);
    if (!(d >= 0) || !(a > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) { onMudou("Confira valor diário, meta e prazo."); return; }
    setOcupado(true);
    const r = await patch(`/api/financeiro/metas-poupanca/${m.id}`, { aporte_diario: d, valor_alvo: a, data_fim: prazo, chave_pix: pix });
    setOcupado(false);
    if (r.ok) setEditando(false);
    onMudou(r.ok ? "Meta atualizada." : (r.erro ?? "Erro ao salvar."));
  };

  const alternarCobranca = async () => {
    const r = await patch(`/api/financeiro/metas-poupanca/${m.id}`, { cobrar_diariamente: !m.cobrarDiariamente });
    onMudou(r.ok ? (m.cobrarDiariamente ? "Cobrança diária desligada." : "Cobrança diária ligada.") : (r.erro ?? "Erro."));
  };

  const cor = p.concluida || p.vaiBater ? "bg-green-500" : p.pct >= 30 ? "bg-yellow-500" : "bg-primary";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PiggyBank className="w-4 h-4 text-primary" /> {m.descricao}
          </CardTitle>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={alternarCobranca}
              className={cn(
                "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                m.cobrarDiariamente ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
              title="O Max cobra pelo WhatsApp às 9h e lembra às 20h se faltar"
            >
              {m.cobrarDiariamente ? "Max cobra todo dia" : "Cobrança desligada"}
            </button>
            <Button variant="ghost" size="sm" onClick={() => setEditando((e) => !e)} aria-label="Editar meta">
              <Pencil className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="text-foreground font-medium">{BRL.format(m.atual)} <span className="text-muted-foreground font-normal">de {BRL.format(m.alvo)}</span></span>
            <span className="font-medium">{p.pct.toLocaleString("pt-BR")}%</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", cor)} style={{ width: `${Math.min(p.pct, 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Prazo {dataBR(m.dataFim)} · faltam {BRL.format(p.falta)} em {p.diasRestantes} dias
          </p>
        </div>

        {!p.concluida && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Info rotulo="Guardar hoje" valor={p.pendenteHoje > 0 ? BRL.format(p.pendenteHoje) : "Feito ✅"} destaque={p.pendenteHoje > 0} />
            <Info rotulo={`No ritmo de ${BRL.format(m.aporteDiario)}/dia`} valor={BRL.format(p.projetadoNoPrazo)} sub="no prazo" />
            <Info rotulo="Para bater a meta" valor={`${BRL.format(p.necessarioPorDia)}/dia`} destaque={!p.vaiBater} />
          </div>
        )}
        {!p.concluida && !p.vaiBater && m.aporteDiario > 0 && (
          <p className="text-xs rounded-md border border-border bg-muted/40 p-2 text-foreground">
            ⚠️ Com {BRL.format(m.aporteDiario)} por dia a meta não fecha no prazo. Aumente o valor diário para {BRL.format(p.necessarioPorDia)}, estenda o prazo ou complemente com aportes extras.
          </p>
        )}
        {p.atraso > 0 && <p className="text-xs text-muted-foreground">Atrasado dos dias anteriores: {BRL.format(p.atraso)}</p>}

        {editando && (
          <div className="grid gap-2 sm:grid-cols-4 items-end">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Valor por dia</span><input className={inputCls} value={diario} onChange={(e) => setDiario(e.target.value)} inputMode="decimal" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Meta</span><input className={inputCls} value={alvo} onChange={(e) => setAlvo(e.target.value)} inputMode="decimal" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Prazo</span><input type="date" className={inputCls} value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>
            <label className="space-y-1 sm:col-span-3"><span className="text-xs text-muted-foreground">Chave Pix da reserva</span><input className={inputCls} value={pix} onChange={(e) => setPix(e.target.value)} placeholder="Chave que o Max manda junto da cobrança" /></label>
            <Button size="sm" onClick={salvar} disabled={ocupado}><Check className="w-4 h-4 mr-1" />Salvar</Button>
          </div>
        )}

        {m.chavePix && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5">
            <span className="text-xs text-muted-foreground">Pix da reserva</span>
            <code className="text-xs text-foreground break-all">{m.chavePix}</code>
            <Button variant="ghost" size="sm" onClick={() => copiar(m.chavePix!, "Chave Pix")} aria-label="Copiar chave Pix">
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {!p.concluida && (
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(inputCls, "w-32")} value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" aria-label="Valor" />
            <Button size="sm" onClick={() => aportar(1)} disabled={ocupado}>
              {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardei"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => aportar(-1)} disabled={ocupado}>Retirei</Button>
          </div>
        )}

        {m.ultimosAportes.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Últimos aportes</p>
            <ul className="divide-y divide-border text-sm">
              {m.ultimosAportes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-muted-foreground">{dataBR(a.data)}{a.origem === "inicial" ? " · saldo inicial" : a.origem === "max" ? " · pelo Max" : ""}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn("font-medium", a.valor < 0 ? "text-destructive" : "text-foreground")}>{BRL.format(a.valor)}</span>
                    <button type="button" onClick={() => excluir(a.id)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir aporte">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Info({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className={cn("text-sm font-semibold", destaque ? "text-primary" : "text-foreground")}>{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
