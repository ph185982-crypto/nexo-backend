"use client";

import { useEffect, useState } from "react";
import type { CartaoDTO, EtapaDTO } from "@/lib/funil/quadro";
import { diasDesde } from "@/lib/funil/encerramento";
import { data, dataHora, moeda, PROBABILIDADE } from "@/lib/formatar";

interface Linha { id: string; paraFunilNome: string; paraEtapaNome: string; paraTipo: string; entrouEm: string; saiuEm: string | null; origem: string; ator: string | null; motivo: string | null }

function duracao(entrou: string, saiu: string | null): string {
  const d = diasDesde(entrou, saiu ? new Date(saiu) : new Date());
  return d === 0 ? "hoje" : `${d}d`;
}

const Item = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-linha py-2.5">
    <span className="text-[12px] text-cinza">{rotulo}</span>
    <span className="text-right font-semibold">{children}</span>
  </div>
);

export function Painel({ c, etapaNome, etapas, onMover, onFechar }: { c: CartaoDTO; etapaNome: string; etapas: EtapaDTO[]; onMover: (etapaId: string) => void; onFechar: () => void }) {
  const [historico, setHistorico] = useState<Linha[] | null>(null);
  const vendedorIa = process.env.NEXT_PUBLIC_VENDEDOR_IA_URL;

  useEffect(() => {
    let vivo = true;
    setHistorico(null);
    fetch(`/api/oportunidades/${c.id}/historico`).then((r) => r.json()).then((j) => { if (vivo) setHistorico(j.historico ?? []); }).catch(() => { if (vivo) setHistorico([]); });
    return () => { vivo = false; };
  }, [c.id, c.etapaId]);

  return (
    <aside className="h-full w-[400px] flex-none overflow-y-auto border-l border-linha bg-superficie" aria-label="Resumo da oportunidade">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold leading-tight">{c.nome}</h2>
          <p className="text-[12px] font-semibold text-cinza">{c.codigo}</p>
        </div>
        <button onClick={onFechar} aria-label="Fechar painel" className="rounded-md px-2 py-1 text-[18px] leading-none text-cinza hover:bg-bq">×</button>
      </div>

      <div className="mx-5 mt-4 rounded-xl bg-azul px-4 py-3.5 text-bq">
        <b className="font-titulo text-[26px] font-extrabold leading-none">{moeda(c.valorTotal)}</b>
        <span className="mt-1 block text-[11px] opacity-90">Total{c.valorMensal > 0 ? ` · Mensal ${moeda(c.valorMensal)}` : ""}</span>
      </div>

      <label className="mx-5 mt-4 block">
        <span className="mb-1 block text-[12px] font-semibold text-cinza">Mover para</span>
        <select value={c.etapaId} onChange={(e) => onMover(e.target.value)} className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-2 text-[13px] font-semibold">
          {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.tipo === "GANHA" ? " (ganha)" : e.tipo === "PERDIDA" ? " (perdida)" : ""}</option>)}
        </select>
      </label>

      <div className="px-5 pt-2">
        <Item rotulo="Empresa"><span className="text-azul">{c.contato.nome}</span></Item>
        {c.pessoa && <Item rotulo="Contato relacionado">{c.pessoa.nome}</Item>}
        <Item rotulo="Responsável">{c.responsavel ?? "—"}</Item>
        <Item rotulo="Etapa atual">{etapaNome}</Item>
        <Item rotulo="Criada em">{dataHora(c.criadoEm)}</Item>
        <Item rotulo="Probabilidade">{c.probabilidade ? <span className="rounded-full bg-laranja px-2.5 py-0.5 text-[11px] font-bold text-grafite">{PROBABILIDADE[c.probabilidade] ?? c.probabilidade}</span> : "—"}</Item>
        <Item rotulo="Origem">{c.origem ?? "—"}</Item>
        <Item rotulo="Finaliza em">{data(c.finalizaEm)}</Item>
        {c.status !== "EM_ANDAMENTO" && <Item rotulo="Motivo">{c.motivo ?? "Sem motivo registrado"}</Item>}
      </div>

      {c.vendedorIaLeadId && (
        <>
          <h3 className="px-5 pb-1 pt-5 text-[13px] font-extrabold">Conversa</h3>
          <div className="mx-5 rounded-xl border border-linha px-3.5 py-3">
            <p className="text-[12px] text-cinza">Esta oportunidade veio do Vendedor IA. A conversa completa fica lá.</p>
            {vendedorIa && (
              <a href={`${vendedorIa}/crm/conversations`} target="_blank" rel="noreferrer"
                className="mt-2.5 inline-block rounded-lg border border-azul px-3 py-1.5 text-[12px] font-bold text-azul">
                Abrir no Vendedor IA ↗
              </a>
            )}
          </div>
        </>
      )}

      <h3 className="px-5 pb-1 pt-5 text-[13px] font-extrabold">Histórico de etapas</h3>
      <ol className="px-5 pb-8">
        {historico === null && <li className="py-2 text-[12px] text-cinza">Carregando…</li>}
        {historico?.length === 0 && <li className="py-2 text-[12px] text-cinza">Sem registros.</li>}
        {historico?.map((h) => (
          <li key={h.id} className="border-b border-linha py-2.5">
            <div className="flex justify-between gap-3">
              <span className="font-semibold">{h.paraEtapaNome}{!h.saiuEm && <span className="ml-1.5 text-[11px] font-bold text-azul">atual</span>}</span>
              <span className="text-[12px] text-cinza">{duracao(h.entrouEm, h.saiuEm)}</span>
            </div>
            <p className="text-[11.5px] text-cinza">
              {dataHora(h.entrouEm)} · {h.origem === "CRIACAO" ? "criada" : h.origem === "INTEGRACAO" ? "Vendedor IA" : h.origem === "IMPORTACAO" ? "reconstruída" : h.ator ? "movida" : h.origem.toLowerCase()}
              {h.motivo ? ` · ${h.motivo}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
