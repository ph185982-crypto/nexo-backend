"use client";

// Contratos e recorrentes da aba Contas: financiamento, parcela do carro, empréstimo,
// internet, água e luz. Cadastra uma vez; o sistema gera as contas do mês e do seguinte.
// Editar o valor da parcela vale para as contas pendentes; encerrar cancela as que ainda
// não venceram (nada é apagado, tudo fica no Histórico).

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, Pencil, Plus, Repeat, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TIPO_NEGOCIO_OPTIONS, formatTipoNegocio } from "@/lib/finance/labels";
import { BRL, fmtData } from "./receitas-shared";
import { Campo, fmtInput, inputCls, parseValor, patch } from "./EditarDialogs";
import { hojeBR } from "./FiltroPeriodo";

interface Contrato {
  id: string;
  descricao: string;
  credor: string | null;
  categoria: string;
  tipo_negocio: string;
  valor_parcela: number;
  parcelas_total: number | null;
  dia_vencimento: number;
  entrada: number | null;
  entrada_data: string | null;
  saldo_devedor: number | null;
  estimada: boolean;
  status: string;
  observacao: string | null;
  pagas: number;
  pendentes: number;
  restantes: number | null;
  valor_restante: number | null;
  proxima: { vencimento: string; valor: number; numero: number } | null;
}

const VAZIO = {
  descricao: "", credor: "", valor: "", parcelas: "", dia: "1", primeiro: "", categoria: "", negocio: "pessoal",
  entrada: "", entradaData: "", saldo: "", estimada: false, observacao: "",
};

export function ContratosDespesaPanel({ onChange }: { onChange: () => void }) {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(true);
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Contrato | null>(null);
  const [encerrando, setEncerrando] = useState<Contrato | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/financeiro/contratos-despesa");
      if (r.ok) setContratos((await r.json()).contratos ?? []);
    } catch { /* silencioso */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const depois = (msg: string) => { setAviso(msg); void carregar(); onChange(); };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = parseValor(f.valor);
    if (!(valor > 0)) { setErro("Informe o valor da parcela."); return; }
    setSalvando(true); setErro(null);
    try {
      const res = await fetch("/api/financeiro/contratos-despesa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: f.descricao, credor: f.credor, valor_parcela: valor,
          parcelas_total: f.parcelas.trim() ? Number(f.parcelas) : null,
          dia_vencimento: Number(f.dia) || undefined, primeiro_vencimento: f.primeiro,
          categoria: f.categoria, tipo_negocio: f.negocio,
          entrada: f.entrada.trim() ? parseValor(f.entrada) : null, entrada_data: f.entradaData || null,
          saldo_devedor: f.saldo.trim() ? parseValor(f.saldo) : null,
          estimada: f.estimada, observacao: f.observacao,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(j.error ?? `Erro ${res.status}`); return; }
      setF(VAZIO); setNovo(false);
      depois(`Contrato criado. ${j.contasGeradas ?? 0} conta(s) já entraram na lista.`);
    } catch { setErro("Sem conexão com o servidor."); } finally { setSalvando(false); }
  };

  const ativos = contratos.filter((c) => c.status === "ativo");
  const encerrados = contratos.filter((c) => c.status !== "ativo");
  const porMes = ativos.reduce((a, c) => a + c.valor_parcela, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="flex items-center gap-2 text-left">
            <CardTitle className="text-base flex items-center gap-2">
              <Repeat className="w-4 h-4 text-muted-foreground" /> Contratos e recorrentes
              <span className="text-xs font-normal text-muted-foreground">
                ({ativos.length}{ativos.length > 0 ? ` · ~${BRL.format(porMes)} por mês` : ""})
              </span>
            </CardTitle>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", !aberto && "-rotate-90")} />
          </button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => { setNovo(!novo); setErro(null); setAberto(true); }}>
            <Plus className="w-3.5 h-3.5" /> Novo contrato
          </Button>
        </div>
      </CardHeader>
      {aberto && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Cadastre uma vez (parcela do carro, financiamento, internet, água, luz). As contas do mês e do mês seguinte aparecem sozinhas na lista abaixo.
            Cartões de crédito continuam sendo lançados à mão, porque mudam todo mês.
          </p>
          {aviso && (
            <div role="status" className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span>{aviso}</span>
              <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-muted-foreground">×</button>
            </div>
          )}

          {novo && (
            <form onSubmit={criar} className="rounded-lg border border-border p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Campo label="Nome"><input className={inputCls} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} required maxLength={80} placeholder="Ex.: Parcela do carro" /></Campo>
              <Campo label="Valor da parcela (R$)"><input className={inputCls} inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} required /></Campo>
              <Campo label="Nº de parcelas" dica="Vazio = sem fim"><input className={inputCls} inputMode="numeric" value={f.parcelas} onChange={(e) => setF({ ...f, parcelas: e.target.value.replace(/\D/g, "") })} /></Campo>
              <Campo label="Dia do vencimento"><input className={inputCls} inputMode="numeric" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value.replace(/\D/g, "") })} /></Campo>
              <Campo label="Vencimento da 1ª parcela"><input type="date" className={inputCls} value={f.primeiro} onChange={(e) => setF({ ...f, primeiro: e.target.value })} required /></Campo>
              <Campo label="Categoria"><input className={inputCls} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="Ex.: Casa" /></Campo>
              <Campo label="Negócio">
                <select className={inputCls} value={f.negocio} onChange={(e) => setF({ ...f, negocio: e.target.value })}>
                  {TIPO_NEGOCIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Campo>
              <Campo label="Credor (opcional)"><input className={inputCls} value={f.credor} onChange={(e) => setF({ ...f, credor: e.target.value })} /></Campo>
              <Campo label="Entrada (opcional)"><input className={inputCls} inputMode="decimal" value={f.entrada} onChange={(e) => setF({ ...f, entrada: e.target.value })} /></Campo>
              <Campo label="Vencimento da entrada"><input type="date" className={inputCls} value={f.entradaData} onChange={(e) => setF({ ...f, entradaData: e.target.value })} /></Campo>
              <Campo label="Saldo devedor (opcional)"><input className={inputCls} inputMode="decimal" value={f.saldo} onChange={(e) => setF({ ...f, saldo: e.target.value })} /></Campo>
              <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
                <input type="checkbox" checked={f.estimada} onChange={(e) => setF({ ...f, estimada: e.target.checked })} />
                Valor aproximado (água, luz)
              </label>
              {erro && <p className="sm:col-span-2 lg:col-span-4 text-sm text-red-500">{erro}</p>}
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setNovo(false); setErro(null); }}>Cancelar</Button>
                <Button type="submit" size="sm" disabled={salvando} className="gap-1">{salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar contrato</Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : ativos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Nenhum contrato ativo.</p>
          ) : (
            <div className="divide-y divide-border">
              {ativos.map((c) => <LinhaContrato key={c.id} c={c} onEditar={() => setEditando(c)} onEncerrar={() => setEncerrando(c)} />)}
            </div>
          )}

          {encerrados.length > 0 && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Encerrados ({encerrados.length})</p>
              {encerrados.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm py-1 opacity-70">
                  <span className="truncate">{c.descricao}</span>
                  <Button variant="ghost" size="sm" className="gap-1" onClick={async () => {
                    const r = await patch(`/api/financeiro/contratos-despesa/${c.id}`, { acao: "reativar" });
                    depois(r.ok ? `"${c.descricao}" reativado.` : (r.erro ?? "Não foi possível reativar."));
                  }}><RotateCcw className="w-3.5 h-3.5" /> Reativar</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}

      <EditarContratoDialog contrato={editando} onClose={() => setEditando(null)} onDone={depois} />
      <Dialog open={!!encerrando} onOpenChange={(o) => { if (!o) setEncerrando(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><XCircle className="w-4 h-4 text-red-500" /> Encerrar este contrato?</DialogTitle>
            <DialogDescription>
              {encerrando && <><strong className="text-foreground">{encerrando.descricao}</strong> deixa de gerar contas e as pendentes que ainda não venceram são canceladas.
              Nada é apagado: as contas pagas e o histórico continuam, e dá para reativar depois.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEncerrando(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={async () => {
              if (!encerrando) return;
              const r = await patch(`/api/financeiro/contratos-despesa/${encerrando.id}`, { acao: "encerrar" });
              const n = Number((r.dados as { canceladas?: number } | undefined)?.canceladas ?? 0);
              setEncerrando(null);
              depois(r.ok ? `Contrato encerrado. ${n} conta(s) futura(s) cancelada(s).` : (r.erro ?? "Não foi possível encerrar."));
            }}>Encerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LinhaContrato({ c, onEditar, onEncerrar }: { c: Contrato; onEditar: () => void; onEncerrar: () => void }) {
  const hoje = hojeBR();
  const atrasada = c.proxima ? c.proxima.vencimento < hoje : false;
  const confirmar = /confirmar/i.test(c.observacao ?? "");
  return (
    <div className="py-2.5 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{c.descricao}</span>
          {c.estimada && <Badge variant="warning" className="text-[10px] py-0">valor aproximado</Badge>}
          {confirmar && <Badge variant="info" className="text-[10px] py-0" title={c.observacao ?? ""}>confirmar dados</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {c.estimada ? "~" : ""}{BRL.format(c.valor_parcela)} por mês · dia {c.dia_vencimento} · {c.categoria} · {formatTipoNegocio(c.tipo_negocio)}
          {c.credor ? ` · ${c.credor}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {c.parcelas_total != null
            ? <>Parcela {Math.min(c.pagas + 1, c.parcelas_total)} de {c.parcelas_total} · {c.pagas} paga(s) · faltam {c.restantes}{c.valor_restante != null ? ` (${BRL.format(c.valor_restante)})` : ""}</>
            : <>Sem prazo final · {c.pagas} paga(s)</>}
          {c.proxima && <> · próxima <span className={cn(atrasada && "text-red-500")}>{fmtData(c.proxima.vencimento)}</span> {BRL.format(c.proxima.valor)}{c.proxima.numero === 0 ? " (entrada)" : ""}</>}
        </p>
        {c.saldo_devedor != null && <p className="text-[11px] text-muted-foreground">Saldo devedor informado: {BRL.format(c.saldo_devedor)}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="outline" size="icon-sm" onClick={onEditar} title="Editar contrato" aria-label={`Editar contrato ${c.descricao}`}><Pencil className="w-3.5 h-3.5" /></Button>
        <Button variant="outline" size="icon-sm" onClick={onEncerrar} title="Encerrar contrato" aria-label={`Encerrar contrato ${c.descricao}`} className="text-red-500 hover:text-red-500"><XCircle className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}

function EditarContratoDialog({ contrato, onClose, onDone }: { contrato: Contrato | null; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ descricao: "", credor: "", valor: "", categoria: "", negocio: "pessoal", saldo: "", estimada: false, observacao: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (contrato) {
      setF({
        descricao: contrato.descricao, credor: contrato.credor ?? "", valor: fmtInput(contrato.valor_parcela), categoria: contrato.categoria,
        negocio: contrato.tipo_negocio, saldo: contrato.saldo_devedor != null ? fmtInput(contrato.saldo_devedor) : "",
        estimada: contrato.estimada, observacao: contrato.observacao ?? "",
      });
      setErro(null);
    }
  }, [contrato]);

  const salvar = async () => {
    if (!contrato) return;
    const valor = parseValor(f.valor);
    if (!f.descricao.trim()) { setErro("Informe o nome."); return; }
    if (!(valor > 0)) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true); setErro(null);
    const r = await patch(`/api/financeiro/contratos-despesa/${contrato.id}`, {
      acao: "editar", descricao: f.descricao, credor: f.credor, valor_parcela: valor, categoria: f.categoria, tipo_negocio: f.negocio,
      saldo_devedor: f.saldo.trim() ? parseValor(f.saldo) : null, estimada: f.estimada, observacao: f.observacao,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro ?? "Não foi possível salvar."); return; }
    onDone("Contrato atualizado. O novo valor vale para as contas pendentes; a versão anterior fica no Histórico.");
    onClose();
  };

  return (
    <Dialog open={!!contrato} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Editar contrato</DialogTitle>
          <DialogDescription>Quantidade de parcelas e datas não mudam aqui. Para isso, encerre e crie um contrato novo.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Campo label="Nome"><input className={inputCls} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={80} /></Campo></div>
          <Campo label="Valor da parcela (R$)"><input className={inputCls} inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
          <Campo label="Saldo devedor"><input className={inputCls} inputMode="decimal" value={f.saldo} onChange={(e) => setF({ ...f, saldo: e.target.value })} /></Campo>
          <Campo label="Categoria"><input className={inputCls} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></Campo>
          <Campo label="Negócio">
            <select className={inputCls} value={f.negocio} onChange={(e) => setF({ ...f, negocio: e.target.value })}>
              {TIPO_NEGOCIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Credor"><input className={inputCls} value={f.credor} onChange={(e) => setF({ ...f, credor: e.target.value })} /></Campo>
          <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
            <input type="checkbox" checked={f.estimada} onChange={(e) => setF({ ...f, estimada: e.target.checked })} /> Valor aproximado
          </label>
          <div className="sm:col-span-2"><Campo label="Observação"><textarea className={cn(inputCls, "h-20 py-2")} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} maxLength={400} /></Campo></div>
        </div>
        {erro && <p className="text-sm text-red-500">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando} className="gap-1.5">{salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
