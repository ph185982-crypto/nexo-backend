"use client";

// Editar e excluir uma conta a pagar. Excluir pede confirmação e deixa cópia no
// Histórico financeiro (dá para restaurar); editar guarda o antes e o depois.

import React, { useEffect, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TIPO_NEGOCIO_OPTIONS } from "@/lib/finance/labels";
import { BRL, fmtData } from "./receitas-shared";
import { Campo, fmtInput, inputCls, parseValor, patch } from "./EditarDialogs";

export interface ContaItem {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  categoria: string;
  tipo_negocio?: string | null;
  status: string;
}

export function EditarContaDialog({
  conta, onClose, onDone,
}: { conta: ContaItem | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ descricao: "", valor: "", data: "", categoria: "", tipo_negocio: "pessoal" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (conta) {
      setF({
        descricao: conta.descricao,
        valor: fmtInput(conta.valor),
        data: conta.vencimento.slice(0, 10),
        categoria: conta.categoria ?? "",
        tipo_negocio: conta.tipo_negocio ?? "pessoal",
      });
      setErro(null);
    }
  }, [conta]);

  const salvar = async () => {
    if (!conta) return;
    const valor = parseValor(f.valor);
    if (!f.descricao.trim()) { setErro("Informe a descrição."); return; }
    if (!(valor > 0)) { setErro("Informe um valor maior que zero."); return; }
    if (!f.data) { setErro("Informe a data de vencimento."); return; }
    setSalvando(true);
    setErro(null);
    const r = await patch(`/api/financeiro/contas/${conta.id}`, {
      acao: "editar", descricao: f.descricao, valor, data_vencimento: f.data, categoria: f.categoria, tipo_negocio: f.tipo_negocio,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro ?? "Não foi possível salvar."); return; }
    onDone("Conta atualizada. A versão anterior continua no histórico.");
    onClose();
  };

  return (
    <Dialog open={!!conta} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Editar conta a pagar</DialogTitle>
          <DialogDescription>Altera só esta conta. A versão anterior fica guardada no Histórico.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Campo label="Descrição">
              <input className={inputCls} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={120} />
            </Campo>
          </div>
          <Campo label="Valor (R$)">
            <input className={inputCls} inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
          </Campo>
          <Campo label="Vencimento">
            <input type="date" className={inputCls} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
          </Campo>
          <Campo label="Categoria">
            <input className={inputCls} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} maxLength={60} />
          </Campo>
          <Campo label="Negócio">
            <select className={inputCls} value={f.tipo_negocio} onChange={(e) => setF({ ...f, tipo_negocio: e.target.value })}>
              {TIPO_NEGOCIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
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

export function ExcluirContaDialog({
  conta, onClose, onDone,
}: { conta: ContaItem | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { if (conta) setErro(null); }, [conta]);

  const excluir = async () => {
    if (!conta) return;
    setExcluindo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/financeiro/contas/${conta.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErro(j.error ?? `Erro ${res.status}`);
        return;
      }
      onDone(`"${conta.descricao}" excluída. Uma cópia ficou no Histórico e pode ser restaurada.`);
      onClose();
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <Dialog open={!!conta} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-500" /> Excluir esta conta?</DialogTitle>
          <DialogDescription>
            {conta && (
              <>
                <strong className="text-foreground">{conta.descricao}</strong> · {BRL.format(conta.valor)} · vence {fmtData(conta.vencimento)}
                <br />
                Ela some da lista de contas a pagar. Uma cópia fica no Histórico financeiro e dá para restaurar depois.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {erro && <p className="text-sm text-red-500">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={excluindo}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void excluir()} disabled={excluindo} className="gap-1.5">
            {excluindo && <Loader2 className="w-4 h-4 animate-spin" />} Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
