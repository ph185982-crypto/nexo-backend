"use client";

// Edição de valores: de uma receita em aberto e de um contrato (propaga para as
// parcelas em aberto — recebidas e perdidas nunca mudam).

import React, { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BRL, type ReceitaItem } from "./receitas-shared";

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary";

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {dica && <span className="block text-[11px] text-muted-foreground">{dica}</span>}
    </label>
  );
}

/** "1.234,56" ou "1234.56" → 1234.56 (NaN se inválido). */
function parseValor(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(norm);
}
const fmtInput = (n: number) => String(n).replace(".", ",");

async function patch(url: string, corpo: Record<string, unknown>): Promise<{ ok: boolean; erro?: string; dados?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, dados: j } : { ok: false, erro: j.error ?? `Erro ${res.status}` };
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." };
  }
}

export function EditarReceitaDialog({
  receita, onClose, onDone,
}: { receita: ReceitaItem | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ valor: "", descricao: "", data: "", cliente: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (receita) {
      setF({ valor: fmtInput(receita.valor), descricao: receita.descricao, data: receita.data_prevista.slice(0, 10), cliente: receita.cliente ?? "" });
      setErro(null);
    }
  }, [receita]);

  const salvar = async () => {
    if (!receita) return;
    const valor = parseValor(f.valor);
    if (!(valor > 0)) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true);
    setErro(null);
    const r = await patch(`/api/financeiro/receitas/${receita.id}`, {
      acao: "editar", valor, descricao: f.descricao, data_prevista: f.data, cliente: f.cliente,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro ?? "Não foi possível salvar."); return; }
    onDone("Receita atualizada. A versão anterior continua no histórico.");
    onClose();
  };

  return (
    <Dialog open={!!receita} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Editar receita</DialogTitle>
          <DialogDescription>Altera só esta receita. Para mudar todas as parcelas de um contrato, use &quot;Editar valores&quot; no contrato.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Campo label="Valor (R$)"><input inputMode="decimal" className={inputCls} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
          <Campo label="Descrição"><input className={inputCls} value={f.descricao} maxLength={200} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Data prevista"><input type="date" className={inputCls} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Campo>
            <Campo label="Cliente"><input className={inputCls} value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></Campo>
          </div>
        </div>
        {erro && <p className="text-sm text-red-500">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando} className="gap-1.5">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ContratoEditavel {
  id: string;
  descricao: string;
  cliente: string | null;
  modo: "recorrente" | "parcelada";
  valor_parcela: number;
  valor_total: number | null;
  parcelas: { abertas: { quantidade: number; total: number } };
}

export function EditarContratoDialog({
  contrato, onClose, onDone,
}: { contrato: ContratoEditavel | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ descricao: "", cliente: "", parcela: "", total: "", aPartir: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (contrato) {
      setF({ descricao: contrato.descricao, cliente: contrato.cliente ?? "", parcela: fmtInput(contrato.valor_parcela), total: contrato.valor_total ? fmtInput(contrato.valor_total) : "", aPartir: "" });
      setErro(null);
    }
  }, [contrato]);

  const salvar = async () => {
    if (!contrato) return;
    const corpo: Record<string, unknown> = { acao: "editar", descricao: f.descricao, cliente: f.cliente };
    const parcela = parseValor(f.parcela);
    const total = parseValor(f.total);
    if (contrato.modo === "parcelada" && f.total.trim() && total !== contrato.valor_total) {
      if (!(total > 0)) { setErro("Informe um total maior que zero."); return; }
      corpo.valor_total = total;
    } else if (parcela !== contrato.valor_parcela) {
      if (!(parcela > 0)) { setErro("Informe um valor de parcela maior que zero."); return; }
      corpo.valor_parcela = parcela;
    }
    if (f.aPartir) corpo.a_partir_de = f.aPartir;
    setSalvando(true);
    setErro(null);
    const r = await patch(`/api/financeiro/contratos/${contrato.id}`, corpo);
    setSalvando(false);
    if (!r.ok) { setErro(r.erro ?? "Não foi possível salvar."); return; }
    onDone(`Contrato atualizado — ${r.dados?.parcelasAtualizadas ?? 0} parcela(s) em aberto ajustada(s). Recebidas e perdidas não mudam.`);
    onClose();
  };

  const abertas = contrato?.parcelas.abertas.quantidade ?? 0;

  return (
    <Dialog open={!!contrato} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Editar valores do contrato</DialogTitle>
          <DialogDescription>
            O novo valor vale para as {abertas} parcela(s) em aberto ({contrato ? BRL.format(contrato.parcelas.abertas.total) : ""} hoje) e para as próximas geradas.
            O que já foi recebido ou perdido não muda, e tudo fica no histórico.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Campo label="Valor da parcela (R$)">
            <input inputMode="decimal" className={inputCls} value={f.parcela} onChange={(e) => setF({ ...f, parcela: e.target.value })} />
          </Campo>
          {contrato?.modo === "parcelada" && (
            <Campo label="Valor total (R$)" dica="Se mudar o total, o restante é redistribuído nas parcelas em aberto (tem prioridade sobre o valor da parcela).">
              <input inputMode="decimal" className={inputCls} value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} />
            </Campo>
          )}
          <Campo label="Aplicar a partir de (opcional)" dica="Vazio = todas as parcelas em aberto. Ex.: 01/11/2026 só muda de novembro em diante.">
            <input type="date" className={inputCls} value={f.aPartir} onChange={(e) => setF({ ...f, aPartir: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Descrição"><input className={inputCls} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Campo>
            <Campo label="Cliente"><input className={inputCls} value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></Campo>
          </div>
        </div>
        {erro && <p className="text-sm text-red-500">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando} className="gap-1.5">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
