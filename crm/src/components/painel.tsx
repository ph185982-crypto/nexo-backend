"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartaoDTO, EtapaDTO } from "@/lib/funil/quadro";
import { diasDesde } from "@/lib/funil/encerramento";
import { data, dataHora, moeda, PROBABILIDADE } from "@/lib/formatar";
import { INTENCOES, ROTULO_INTENCAO } from "@/lib/atividades/intencoes";
import { ROTULO_TIPO_FEEDBACK } from "@/lib/formatar-atividades";
import { NovaTarefa } from "./form-tarefa";
import { TarefaItem, type TarefaDTO } from "./tarefa-item";
import { botaoPrimario, campo } from "./dialogo";
import { AbaCombinados } from "./ficha-combinados";
import { AbaConversa } from "./ficha-conversa";

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

export function Painel({ c, etapaNome, etapas, onMover, onFechar, onAtividade }: { c: CartaoDTO; etapaNome: string; etapas: EtapaDTO[]; onMover: (etapaId: string) => void; onFechar: () => void; onAtividade: () => void }) {
  const [historico, setHistorico] = useState<Linha[] | null>(null);
  const [aba, setAba] = useState<Aba>("linha");
  const vendedorIa = process.env.NEXT_PUBLIC_VENDEDOR_IA_URL;
  // Esc fecha a ficha (se nenhum diálogo estiver aberto por cima: eles tratam o Esc antes).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);

  useEffect(() => {
    let vivo = true;
    setHistorico(null);
    fetch(`/api/oportunidades/${c.id}/historico`).then((r) => r.json()).then((j) => { if (vivo) setHistorico(j.historico ?? []); }).catch(() => { if (vivo) setHistorico([]); });
    return () => { vivo = false; };
  }, [c.id, c.etapaId]);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-grafite/45 lg:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
    <section role="dialog" aria-modal="true" aria-label={`Ficha: ${c.nome}`} className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden bg-superficie lg:rounded-2xl lg:shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-linha px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-extrabold leading-tight">{c.nome}</h2>
          <p className="text-[12px] font-semibold text-cinza">{c.codigo} · {c.contato.nome}{c.pessoa ? ` · ${c.pessoa.nome}` : ""} · {etapaNome}</p>
        </div>
        <button onClick={onFechar} aria-label="Fechar ficha" className="rounded-md px-2 py-1 text-[20px] leading-none text-cinza hover:bg-bq">×</button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="order-2 border-t border-linha lg:order-none lg:w-[340px] lg:flex-none lg:overflow-y-auto lg:border-r lg:border-t-0" aria-label="Resumo da oportunidade">
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

      {c.entregaId && (
        <a href={`/entrega/${c.entregaId}`} className="mx-5 mt-4 flex items-center justify-between rounded-xl border border-azul px-3.5 py-2.5 text-[13px] font-bold text-azul">Abrir a entrega <span aria-hidden>→</span></a>
      )}

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
      <div className="min-w-0 flex-1 lg:overflow-y-auto">
        <div role="tablist" className="sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-linha bg-superficie px-5">
          {ABAS.map(([id, rotulo]) => (
            <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
              className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-[13px] font-semibold ${aba === id ? "border-azul text-azul" : "border-transparent text-cinza"}`}>{rotulo}</button>
          ))}
        </div>
        {aba === "linha" && <AbaFeedback oportunidadeId={c.id} onAtividade={onAtividade} />}
        {aba === "combinados" && <AbaCombinados oportunidadeId={c.id} onAtividade={onAtividade} />}
        {aba === "tarefas" && <AbaTarefas oportunidadeId={c.id} onAtividade={onAtividade} />}
        {aba === "conversa" && <AbaConversa oportunidadeId={c.id} contatoId={c.pessoa?.id ?? c.contato.id} onAtividade={onAtividade} />}
      </div>
      </div>
    </section>
    </div>
  );
}

type Aba = "linha" | "combinados" | "tarefas" | "conversa";
const ABAS: ReadonlyArray<readonly [Aba, string]> = [["linha", "Linha do tempo"], ["combinados", "Combinados"], ["tarefas", "Tarefas"], ["conversa", "Conversa (WhatsApp)"]];

/** Tarefa ou feedback muda o aviso "sem próxima atividade" e os indicadores do cartão: o quadro recarrega. */
function AbaTarefas({ oportunidadeId, onAtividade }: { oportunidadeId: string; onAtividade: () => void }) {
  const [tarefas, setTarefas] = useState<TarefaDTO[] | null>(null);
  const [nova, setNova] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/tarefas?visao=abertas&responsavel=todos&oportunidadeId=${oportunidadeId}`);
    if (r.ok) setTarefas((await r.json()).tarefas);
  }, [oportunidadeId]);
  useEffect(() => { setTarefas(null); void carregar(); }, [carregar]);
  const mudou = async () => { await carregar(); onAtividade(); };
  return (
    <div className="px-5 pb-8 pt-3">
      <button onClick={() => setNova(true)} className={`${botaoPrimario} w-full`}>Nova tarefa</button>
      <ul className="mt-2">
        {tarefas === null && <li className="py-3 text-[12px] text-cinza">Carregando…</li>}
        {tarefas?.length === 0 && <li className="py-3 text-[12px] text-cinza">Nenhuma tarefa aberta. Sem próxima atividade, o cartão fica marcado em laranja.</li>}
        {tarefas?.map((t) => <TarefaItem key={t.id} t={t} onMudou={mudou} mostrarVinculo={false} />)}
      </ul>
      {nova && <NovaTarefa oportunidadeId={oportunidadeId} onFechar={() => setNova(false)} onCriada={() => { setNova(false); void mudou(); }} />}
    </div>
  );
}

interface FeedbackDTO { id: string; tipo: string; texto: string; intencao: string | null; importante: boolean; autorNome: string | null; autor: string | null; criadoEm: string }
const COR_SAUDE: Record<string, string> = { QUENTE: "Quente", MORNA: "Morna", FRIA: "Fria", RISCO_ALTO: "Risco alto" };

function AbaFeedback({ oportunidadeId, onAtividade }: { oportunidadeId: string; onAtividade: () => void }) {
  const [dados, setDados] = useState<{ feedbacks: FeedbackDTO[]; saude: { nota: number; rotulo: string } } | null>(null);
  const [tipo, setTipo] = useState("NOTA");
  const [intencao, setIntencao] = useState("");
  const [importante, setImportante] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/feedbacks`);
    if (r.ok) setDados(await r.json());
  }, [oportunidadeId]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/feedbacks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, texto, intencao: intencao || null, importante }) });
    setEnviando(false);
    if (r.ok) { setTexto(""); setIntencao(""); setImportante(false); await carregar(); onAtividade(); }
  };

  return (
    <div className="px-5 pb-8 pt-3">
      {dados && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-linha px-3.5 py-2.5" title="Parte de 50; soma o peso dos sinais de intenção dos últimos 30 dias e desconta 1 ponto por dia parado além de 7.">
          <span className="text-[12px] font-semibold text-cinza">Saúde do negócio</span>
          <span className="font-bold"><span className="font-titulo text-[18px] font-extrabold">{dados.saude.nota}</span> <span className="text-[12px] text-cinza">· {COR_SAUDE[dados.saude.rotulo]}</span></span>
        </div>
      )}
      <form onSubmit={enviar} className="space-y-2">
        <textarea required rows={5} maxLength={5000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que aconteceu nesta interação? O que ficou combinado, com quem e para quando?" className={campo} />
        <p className="text-[11.5px] text-cinza">O agente lê o que você registra e sugere os combinados na aba Combinados.</p>
        <div className="flex gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo" className={`${campo} !py-2 !text-[12px]`}>
            {Object.entries(ROTULO_TIPO_FEEDBACK).filter(([k]) => k !== "SISTEMA").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={intencao} onChange={(e) => setIntencao(e.target.value)} aria-label="Intenção" className={`${campo} !py-2 !text-[12px]`}>
            <option value="">Sem sinal</option>
            {INTENCOES.map((i) => <option key={i} value={i}>{ROTULO_INTENCAO[i]}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={importante} onChange={(e) => setImportante(e.target.checked)} className="accent-[var(--azul)]" />Importante</label>
          <button type="submit" disabled={enviando || !texto.trim()} className={botaoPrimario}>Registrar</button>
        </div>
      </form>
      <ol className="mt-4">
        {dados === null && <li className="py-3 text-[12px] text-cinza">Carregando…</li>}
        {dados?.feedbacks.length === 0 && <li className="py-3 text-[12px] text-cinza">Sem interações registradas.</li>}
        {dados?.feedbacks.map((f) => (
          <li key={f.id} className="border-b border-linha py-3">
            <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-cinza">
              <span className="font-bold text-grafite">{ROTULO_TIPO_FEEDBACK[f.tipo] ?? f.tipo}</span>
              <span>{f.autorNome ?? (f.autor === "vendedor-ia" ? "Vendedor IA" : f.autor ?? "")}</span>
              <span>{dataHora(f.criadoEm)}</span>
              {f.importante && <span className="rounded-full bg-laranja px-2 py-0.5 text-[10px] font-bold text-grafite">Importante</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{f.texto}</p>
            {f.intencao && <span className="mt-1.5 inline-block rounded-full bg-azul-8 px-2.5 py-0.5 text-[11px] font-semibold text-azul">{ROTULO_INTENCAO[f.intencao as keyof typeof ROTULO_INTENCAO] ?? f.intencao}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
