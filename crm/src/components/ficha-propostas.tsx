"use client";

import { useCallback, useEffect, useState } from "react";
import { data, dataHora, moeda } from "@/lib/formatar";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";

interface Proposta {
  id: string; codigo: string; versao: number; status: string; titulo: string; introducao: string; condicoes: string;
  itens: Array<{ nome: string; total: number; recorrencia: string }>; valorUnico: number; valorMensal: number; validaAte: string | null; token: string;
  enviadaEm: string | null; visualizadaEm: string | null; respondidaEm: string | null; respostaNome: string | null; respostaComentario: string | null; criadoEm: string;
}
const ROTULO: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADA: "Enviada", ACEITA: "Aceita", RECUSADA: "Recusada", OBSOLETA: "Substituída" };
const COR: Record<string, string> = { RASCUNHO: "border border-linha text-cinza", ENVIADA: "bg-azul-8 text-azul", ACEITA: "bg-azul text-bq", RECUSADA: "bg-laranja text-grafite", OBSOLETA: "border border-linha text-cinza" };

/** Propostas da oportunidade: criar a partir dos produtos, ajustar o texto, enviar o link e acompanhar a resposta. */
export function AbaPropostas({ oportunidadeId, onAtividade }: { oportunidadeId: string; onAtividade: () => void }) {
  const [lista, setLista] = useState<Proposta[] | null>(null);
  const [telefone, setTelefone] = useState<string | null>(null);
  const [editando, setEditando] = useState<Proposta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/propostas`);
    if (r.ok) { const j = await r.json(); setLista(j.propostas); setTelefone(j.telefone); }
  }, [oportunidadeId]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  const chamar = async (url: string, metodo: string) => {
    setOcupado(true); setAviso(null);
    const r = await fetch(url, { method: metodo });
    const j = (await r.json().catch(() => ({}))) as { erro?: string; link?: string };
    setOcupado(false);
    if (!r.ok) { setAviso(j.erro ?? "Não foi possível concluir"); return null; }
    await carregar(); onAtividade();
    return j;
  };
  const link = (p: Proposta) => `${window.location.origin}/p/${p.token}`;
  const copiar = async (p: Proposta) => {
    try { await navigator.clipboard.writeText(link(p)); setAviso("Link copiado."); } catch { setAviso(`Copie o link: ${link(p)}`); }
  };
  const whatsapp = (p: Proposta) => `https://wa.me/${telefone}?text=${encodeURIComponent(`Olá! Segue a proposta da Avanteza: ${link(p)}\nPor ali você consegue ler, baixar em PDF e aceitar.`)}`;

  const atual = lista?.find((p) => p.status !== "OBSOLETA");
  return (
    <div className="px-5 pb-8 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={ocupado} onClick={() => void chamar(`/api/oportunidades/${oportunidadeId}/propostas`, "POST")} className={botaoPrimario}>{lista?.length ? "Nova versão" : "Nova proposta"}</button>
        <p className="text-[12px] text-cinza">Usa os produtos da oportunidade de agora. Uma versão nova substitui a anterior.</p>
      </div>
      {aviso && <p role="status" className="mt-2 break-all text-[13px] font-semibold">{aviso}</p>}
      <ul className="mt-3 space-y-2.5">
        {lista === null && <li className="text-[12px] text-cinza">Carregando…</li>}
        {lista?.length === 0 && <li className="text-[12px] text-cinza">Nenhuma proposta ainda.</li>}
        {lista?.map((p) => (
          <li key={p.id} className={`rounded-xl border border-linha p-3.5 ${p.status === "OBSOLETA" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{p.codigo}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${COR[p.status]}`}>{ROTULO[p.status]}</span>
              <span className="ml-auto text-[13px] font-bold">{moeda(p.valorUnico)}{p.valorMensal > 0 ? ` + ${moeda(p.valorMensal)}/mês` : ""}</span>
            </div>
            <p className="mt-1 text-[13px]">{p.titulo}</p>
            <p className="mt-1 text-[12px] text-cinza">
              {p.itens.map((i) => i.nome).join(", ")}
              {p.validaAte ? ` · válida até ${data(p.validaAte)}` : ""}
            </p>
            <p className="mt-1 text-[12px] text-cinza">
              {p.enviadaEm ? `Enviada ${dataHora(p.enviadaEm)}` : `Criada ${dataHora(p.criadoEm)}`}
              {p.visualizadaEm ? ` · aberta pelo cliente ${dataHora(p.visualizadaEm)}` : p.enviadaEm ? " · ainda não aberta" : ""}
              {p.respondidaEm ? ` · ${p.status === "ACEITA" ? "aceita" : "recusada"} por ${p.respostaNome} ${dataHora(p.respondidaEm)}` : ""}
            </p>
            {p.respostaComentario && <p className="mt-1.5 rounded-lg bg-bq px-3 py-2 text-[13px]">“{p.respostaComentario}”</p>}
            {p.status === "ACEITA" && <p className="mt-1.5 text-[12px] font-semibold">Aceita pelo cliente: marque a oportunidade como ganha quando o contrato estiver fechado.</p>}
            <div className="mt-2.5 flex flex-wrap gap-2 text-[12px] font-bold">
              {p.status === "RASCUNHO" && <>
                <button onClick={() => setEditando(p)} className="rounded-lg border border-linha px-3 py-1.5">Editar texto</button>
                <button disabled={ocupado} onClick={async () => { const j = await chamar(`/api/propostas/${p.id}/enviar`, "POST"); if (j) setAviso("Enviada. Mande o link ao cliente pelo WhatsApp ou copie."); }} className="rounded-lg bg-azul px-3 py-1.5 text-bq">Enviar</button>
              </>}
              {p.status !== "RASCUNHO" && p.status !== "OBSOLETA" && <>
                {telefone && p.status === "ENVIADA" && <a href={whatsapp(p)} target="_blank" rel="noreferrer" className="rounded-lg bg-azul px-3 py-1.5 text-bq">Mandar no WhatsApp</a>}
                <button onClick={() => void copiar(p)} className="rounded-lg border border-linha px-3 py-1.5">Copiar link</button>
                <a href={`/p/${p.token}`} target="_blank" rel="noreferrer" className="rounded-lg border border-linha px-3 py-1.5">Abrir</a>
              </>}
            </div>
          </li>
        ))}
      </ul>
      {!atual && lista && lista.length > 0 && <p className="mt-2 text-[12px] text-cinza">Todas as versões foram substituídas.</p>}
      {editando && <EditarProposta p={editando} onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await carregar(); }} />}
    </div>
  );
}

function EditarProposta({ p, onFechar, onSalvo }: { p: Proposta; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ titulo: p.titulo, introducao: p.introducao, condicoes: p.condicoes, validaAte: p.validaAte ? new Date(p.validaAte).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "" });
  const [erro, setErro] = useState<string | null>(null);
  const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";
  return (
    <Dialogo titulo="Texto da proposta" onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch(`/api/propostas/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, validaAte: f.validaAte || null }) });
        if (r.ok) onSalvo(); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar");
      }}>
        <label className="block"><span className={rotulo}>Título</span><input id="proposta-titulo" required minLength={3} maxLength={160} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={campo} /></label>
        <label className="block"><span className={rotulo}>Introdução</span><textarea id="proposta-introducao" rows={6} maxLength={5000} value={f.introducao} onChange={(e) => setF({ ...f, introducao: e.target.value })} className={campo} /></label>
        <label className="block"><span className={rotulo}>Condições</span><textarea id="proposta-condicoes" rows={4} maxLength={5000} value={f.condicoes} onChange={(e) => setF({ ...f, condicoes: e.target.value })} className={campo} /></label>
        <label className="block"><span className={rotulo}>Válida até</span><input id="proposta-validade" type="date" value={f.validaAte} onChange={(e) => setF({ ...f, validaAte: e.target.value })} className={campo} /></label>
        <p className="text-[12px] text-cinza">Os itens e valores vêm dos produtos. Para mudar, edite os produtos e crie uma versão nova.</p>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={botaoSecundario}>Cancelar</button><button type="submit" className={botaoPrimario}>Salvar</button></div>
      </form>
    </Dialogo>
  );
}
