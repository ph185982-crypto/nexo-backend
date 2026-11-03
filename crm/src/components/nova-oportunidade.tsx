"use client";

import { useState } from "react";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";

export function NovaOportunidade({ funilId, onFechar, onCriada }: { funilId: string; onFechar: () => void; onCriada: () => void }) {
  const [nome, setNome] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [valorUnico, setValorUnico] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    const valor = valorUnico.trim() === "" ? 0 : Number(valorUnico.includes(",") ? valorUnico.replace(/\./g, "").replace(",", ".") : valorUnico);
    if (!Number.isFinite(valor) || valor < 0) { setErro("Valor inválido"); setSalvando(false); return; }
    const r = await fetch("/api/oportunidades", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, contatoNome, telefone, funilId, valorUnico: valor }),
    });
    setSalvando(false);
    if (r.ok) { onCriada(); return; }
    setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível criar");
  };

  return (
    <Dialogo titulo="Nova oportunidade" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Oportunidade</span>
          <input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Oficina Rocha — vendas e processos" className={campo} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Empresa ou contato</span>
          <input required value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} className={campo} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Telefone</span>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" className={campo} /></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Valor (R$)</span>
            <input value={valorUnico} onChange={(e) => setValorUnico(e.target.value)} inputMode="decimal" className={campo} /></label>
        </div>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={botaoPrimario} disabled={salvando || !nome.trim() || !contatoNome.trim()}>{salvando ? "Criando…" : "Criar"}</button>
        </div>
      </form>
    </Dialogo>
  );
}
