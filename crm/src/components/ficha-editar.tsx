"use client";

import { useEffect, useState } from "react";
import type { CartaoDTO } from "@/lib/funil/quadro";
import { PROBABILIDADE } from "@/lib/formatar";
import { Dialogo, botaoPrimario, botaoSecundario, campo } from "./dialogo";

interface Detalhe { usuarios: Array<{ id: string; nome: string }>; pessoas: Array<{ id: string; nome: string; tipo: string }>; responsavelId: string | null; pessoaId: string | null; produtos: unknown[] }

const diaIso = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");

async function salvar(id: string, corpo: Record<string, unknown>): Promise<string | null> {
  const r = await fetch(`/api/oportunidades/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return r.ok ? null : (((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar");
}

export function EditarOportunidade({ c, onFechar, onSalvo }: { c: CartaoDTO; onFechar: () => void; onSalvo: () => void }) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [f, setF] = useState({
    nome: c.nome, valorUnico: String(c.valorUnico), valorMensal: String(c.valorMensal), probabilidade: c.probabilidade ?? "",
    origem: c.origem ?? "", tags: c.tags.join(", "), finalizaEm: diaIso(c.finalizaEm), responsavelId: "", pessoaId: c.pessoa?.id ?? "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    fetch(`/api/oportunidades/${c.id}`).then((r) => r.json()).then((d: Detalhe) => { setDet(d); setF((x) => ({ ...x, responsavelId: d.responsavelId ?? "", pessoaId: d.pessoaId ?? "" })); }).catch(() => setErro("Não foi possível carregar"));
  }, [c.id]);
  const comProdutos = (det?.produtos.length ?? 0) > 0;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const corpo: Record<string, unknown> = {
      nome: f.nome, probabilidade: f.probabilidade || null, origem: f.origem || null, tags: f.tags,
      finalizaEm: f.finalizaEm || null, responsavelId: f.responsavelId || null, pessoaId: f.pessoaId || null,
    };
    if (!comProdutos) Object.assign(corpo, { valorUnico: f.valorUnico || 0, valorMensal: f.valorMensal || 0 });
    const falha = await salvar(c.id, corpo);
    setEnviando(false);
    if (falha) setErro(falha); else onSalvo();
  };

  const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";
  return (
    <Dialogo titulo="Editar oportunidade" onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-3">
        <label className="block"><span className={rotulo}>Nome</span><input required minLength={2} maxLength={200} value={f.nome} onChange={set("nome")} className={campo} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className={rotulo}>Valor único (R$)</span><input inputMode="decimal" disabled={comProdutos} value={f.valorUnico} onChange={set("valorUnico")} className={`${campo} disabled:opacity-60`} /></label>
          <label className="block"><span className={rotulo}>Valor mensal (R$)</span><input inputMode="decimal" disabled={comProdutos} value={f.valorMensal} onChange={set("valorMensal")} className={`${campo} disabled:opacity-60`} /></label>
        </div>
        {comProdutos && <p className="text-[11.5px] text-cinza">Os valores vêm da aba Produtos.</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className={rotulo}>Probabilidade</span>
            <select value={f.probabilidade} onChange={set("probabilidade")} className={campo}><option value="">—</option>{Object.entries(PROBABILIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="block"><span className={rotulo}>Finaliza em</span><input type="date" value={f.finalizaEm} onChange={set("finalizaEm")} className={campo} /></label>
        </div>
        <label className="block"><span className={rotulo}>Responsável</span>
          <select value={f.responsavelId} onChange={set("responsavelId")} className={campo}><option value="">—</option>{det?.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
        </label>
        <label className="block"><span className={rotulo}>Contato relacionado</span>
          <select value={f.pessoaId} onChange={set("pessoaId")} className={campo}><option value="">—</option>{det?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.tipo === "EMPRESA" ? " (empresa)" : ""}</option>)}</select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className={rotulo}>Origem</span><input maxLength={80} value={f.origem} onChange={set("origem")} className={campo} /></label>
          <label className="block"><span className={rotulo}>Tags (separe por vírgula)</span><input value={f.tags} onChange={set("tags")} className={campo} /></label>
        </div>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} className={botaoSecundario}>Cancelar</button>
          <button type="submit" disabled={enviando || !det} className={botaoPrimario}>Salvar</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Prorrogar = nova data limite, com o motivo registrado na linha do tempo. */
export function Prorrogar({ c, onFechar, onSalvo }: { c: CartaoDTO; onFechar: () => void; onSalvo: () => void }) {
  const base = c.finalizaEm && new Date(c.finalizaEm) > new Date() ? new Date(c.finalizaEm) : new Date();
  const [data, setData] = useState(diaIso(new Date(base.getTime() + 7 * 86_400_000).toISOString()));
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const falha = await salvar(c.id, { finalizaEm: data });
    if (falha) { setErro(falha); return; }
    if (motivo.trim()) await fetch(`/api/oportunidades/${c.id}/feedbacks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo: "NOTA", texto: `Prorrogada para ${new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR")}: ${motivo.trim()}` }) });
    onSalvo();
  };
  return (
    <Dialogo titulo="Prorrogar" onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Nova data limite</span><input required type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Por quê? (opcional)</span><input maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente pediu para retomar depois das férias" className={campo} /></label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={botaoSecundario}>Cancelar</button><button type="submit" className={botaoPrimario}>Prorrogar</button></div>
      </form>
    </Dialogo>
  );
}
