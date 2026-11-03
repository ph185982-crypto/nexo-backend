"use client";

import { useState } from "react";
import { localParaIso, ROTULO_PRIORIDADE, ROTULO_RECORRENCIA, ROTULO_TIPO_TAREFA } from "@/lib/formatar-atividades";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";

export function NovaTarefa({ oportunidadeId, onFechar, onCriada }: { oportunidadeId?: string; onFechar: () => void; onCriada: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("TAREFA");
  const [prioridade, setPrioridade] = useState("NORMAL");
  const [prazo, setPrazo] = useState("");
  const [recorrencia, setRecorrencia] = useState("");
  const [checklist, setChecklist] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true); setErro(null);
    const r = await fetch("/api/tarefas", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titulo, tipo, prioridade, oportunidadeId, prazoEm: localParaIso(prazo), recorrencia: recorrencia || null,
        checklist: checklist.split("\n").map((t) => ({ texto: t, feito: false })).filter((i) => i.texto.trim()),
      }),
    });
    setSalvando(false);
    if (r.ok) { onCriada(); return; }
    setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível criar");
  };

  return (
    <Dialogo titulo="Nova tarefa" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Título</span>
          <input required maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} placeholder="Ex.: ligar para o dono e confirmar a proposta" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>{Object.entries(ROTULO_TIPO_TAREFA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Prioridade</span>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={campo}>{Object.entries(ROTULO_PRIORIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Prazo</span>
            <input type="datetime-local" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={campo} /></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Repetir</span>
            <select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)} className={campo}><option value="">Não repete</option>{Object.entries(ROTULO_RECORRENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Checklist (um item por linha)</span>
          <textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} className={campo} /></label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={botaoPrimario} disabled={salvando || !titulo.trim()}>{salvando ? "Criando…" : "Criar"}</button>
        </div>
      </form>
    </Dialogo>
  );
}
