"use client";

// Aba "Combinados" da ficha: sugestões do agente para aceitar/descartar, combinados pendentes e entregues,
// combinado escrito à mão e "analisar texto" (transcrição de reunião colada).
import { useCallback, useEffect, useState } from "react";
import { data } from "@/lib/formatar";
import { PILARES, ROTULO_PILAR } from "@/lib/entrega/constantes";
import { RESPONSAVEIS, ROTULO_RESPONSAVEL, ROTULO_TIPO_COMBINADO, TIPOS_COMBINADO } from "@/lib/combinados/modelo";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";

interface CombinadoDTO {
  id: string; descricao: string; tipo: string; responsavel: string; prazoEm: string | null; pilar: string | null; status: string; acao: string;
  evidencia: string | null; confianca: number | null; origem: string; cartaoId: string | null; tarefaId: string | null; compromissoId: string | null; entregueEm: string | null;
}
interface AnaliseDTO { id: string; fonte: string; status: string; resumo: string | null; erro: string | null; sugestoes: number; criadoEm: string }
interface Dados { sugeridos: CombinadoDTO[]; pendentes: CombinadoDTO[]; entregues: CombinadoDTO[]; analises: AnaliseDTO[]; agenteLigado: boolean }

const ROTULO_FONTE: Record<string, string> = { FEEDBACK: "Feedback", CONVERSA: "Conversa", REUNIAO: "Reunião", TEXTO: "Texto colado" };
const ROTULO_ANALISE: Record<string, string> = { PENDENTE: "Na fila", PROCESSANDO: "Lendo…", CONCLUIDA: "Lida", ERRO: "Erro", SEM_CHAVE: "Agente desligado" };
const diaIso = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10) : "");
const chip = "rounded-full bg-bq px-2 py-0.5 text-[11px] font-semibold text-cinza";
const vencido = (c: CombinadoDTO) => c.prazoEm !== null && new Date(c.prazoEm).getTime() < Date.now();

function ondeVirou(c: CombinadoDTO) {
  if (c.cartaoId) return "cartão da entrega";
  if (c.compromissoId) return "compromisso na agenda";
  if (c.tarefaId) return "tarefa";
  return null;
}

export function AbaCombinados({ oportunidadeId, onAtividade }: { oportunidadeId: string; onAtividade: () => void }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [analisar, setAnalisar] = useState(false);
  const [editando, setEditando] = useState<CombinadoDTO | null>(null);
  const [verEntregues, setVerEntregues] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/combinados`);
    if (r.ok) setD(await r.json());
  }, [oportunidadeId]);
  useEffect(() => { setD(null); void carregar(); }, [carregar]);
  // Enquanto o agente lê, atualiza sozinho.
  const lendo = d?.analises.some((a) => a.status === "PENDENTE" || a.status === "PROCESSANDO") ?? false;
  useEffect(() => {
    if (!lendo) return;
    const t = setInterval(() => void carregar(), 3000);
    return () => clearInterval(t);
  }, [lendo, carregar]);

  const operar = async (id: string, corpo: Record<string, unknown>) => {
    setErro(null);
    const r = await fetch(`/api/combinados/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar");
    await carregar(); onAtividade();
  };
  const refazer = async (id: string) => { await fetch(`/api/analises/${id}/reprocessar`, { method: "POST" }); await carregar(); };

  if (!d) return <p className="px-5 py-4 text-[12px] text-cinza">Carregando…</p>;
  return (
    <div className="space-y-5 px-5 pb-8 pt-4">
      {!d.agenteLigado && (
        <p className="rounded-xl border border-linha bg-bq px-3.5 py-2.5 text-[12px] text-cinza" role="status">
          O agente que lê feedbacks, conversas e reuniões está desligado: falta a chave da Anthropic (<code>ANTHROPIC_API_KEY</code>) no projeto do CRM. Os combinados à mão funcionam normalmente.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={botaoPrimario} onClick={() => setNovo(true)}>+ Combinado</button>
        <button className={botaoSecundario} onClick={() => setAnalisar(true)}>Analisar transcrição ou texto</button>
        {lendo && <span className="self-center text-[12px] font-semibold text-azul" role="status">O agente está lendo…</span>}
      </div>
      {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}

      <section aria-label="Sugestões do agente">
        <h3 className="mb-2 text-[13px] font-extrabold">Sugestões do agente {d.sugeridos.length > 0 && <span className="ml-1 rounded-full bg-laranja px-2 py-0.5 text-[11px] text-grafite">{d.sugeridos.length}</span>}</h3>
        {d.sugeridos.length === 0 && <p className="text-[12px] text-cinza">Nada para decidir. O agente sugere combinados a partir do que você escreve na linha do tempo, das conversas importadas e das transcrições.</p>}
        <ul className="space-y-2">
          {d.sugeridos.map((c) => (
            <li key={c.id} className="rounded-xl border border-azul/40 bg-superficie p-3.5">
              <p className="font-semibold">{c.descricao}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.acao !== "NOVO" && <span className="rounded-full bg-azul px-2 py-0.5 text-[11px] font-bold text-bq">{c.acao === "CONCLUIR" ? "Marcar como entregue" : "Mudar o prazo"}</span>}
                {c.acao === "NOVO" && <span className={chip}>{ROTULO_TIPO_COMBINADO[c.tipo as keyof typeof ROTULO_TIPO_COMBINADO] ?? c.tipo}</span>}
                {c.acao === "NOVO" && <span className={chip}>Quem cumpre: {ROTULO_RESPONSAVEL[c.responsavel as keyof typeof ROTULO_RESPONSAVEL] ?? c.responsavel}</span>}
                {c.prazoEm && <span className={chip}>Prazo {data(c.prazoEm)}</span>}
                {c.pilar && <span className={chip}>{ROTULO_PILAR[c.pilar as keyof typeof ROTULO_PILAR] ?? c.pilar}</span>}
                {c.confianca !== null && <span className={chip} title="O quanto o texto deixa claro">{Math.round(c.confianca * 100)}% de certeza</span>}
              </div>
              {c.evidencia && <blockquote className="mt-2 border-l-2 border-linha pl-2.5 text-[12px] italic text-cinza">“{c.evidencia}”</blockquote>}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button className={`${botaoPrimario} !px-3 !py-1.5 !text-[12px]`} onClick={() => void operar(c.id, { operacao: "aceitar" })}>Aceitar</button>
                {c.acao === "NOVO" && <button className={`${botaoSecundario} !px-3 !py-1.5 !text-[12px]`} onClick={() => setEditando(c)}>Ajustar e aceitar</button>}
                <button className="px-2 text-[12px] font-semibold text-cinza hover:text-grafite" onClick={() => void operar(c.id, { operacao: "descartar" })}>Descartar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Combinados pendentes">
        <h3 className="mb-2 text-[13px] font-extrabold">Pendentes</h3>
        {d.pendentes.length === 0 && <p className="text-[12px] text-cinza">Nenhum combinado em aberto.</p>}
        <ul className="divide-y divide-linha rounded-xl border border-linha">
          {d.pendentes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.descricao}</p>
                <p className="mt-0.5 text-[12px] text-cinza">
                  {c.responsavel === "CLIENTE" ? "O cliente cumpre" : "Nós cumprimos"}
                  {c.prazoEm ? <> · <span className={vencido(c) ? "font-bold text-critico" : ""}>{vencido(c) ? "venceu em " : "até "}{data(c.prazoEm)}</span></> : " · sem prazo"}
                  {ondeVirou(c) && ` · virou ${ondeVirou(c)}`}
                  {c.origem === "AGENTE" && " · sugerido pelo agente"}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button className={`${botaoSecundario} !px-3 !py-1.5 !text-[12px]`} onClick={() => void operar(c.id, { operacao: "entregue" })}>Entregue</button>
                <button className="px-2 text-[12px] font-semibold text-cinza hover:text-grafite" onClick={() => void operar(c.id, { operacao: "descartar" })} aria-label={`Descartar ${c.descricao}`}>Descartar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {d.entregues.length > 0 && (
        <section aria-label="Combinados entregues">
          <button className="text-[13px] font-extrabold" onClick={() => setVerEntregues((v) => !v)} aria-expanded={verEntregues}>Entregues ({d.entregues.length}) {verEntregues ? "▴" : "▾"}</button>
          {verEntregues && (
            <ul className="mt-2 space-y-1">
              {d.entregues.map((c) => <li key={c.id} className="text-[12.5px]"><span className="text-ok">✓</span> {c.descricao} <span className="text-cinza">· {data(c.entregueEm)}</span></li>)}
            </ul>
          )}
        </section>
      )}

      {d.analises.length > 0 && (
        <section aria-label="Leituras do agente">
          <h3 className="mb-2 text-[13px] font-extrabold">O que o agente leu</h3>
          <ul className="space-y-1.5">
            {d.analises.map((a) => (
              <li key={a.id} className="text-[12px]">
                <span className="font-semibold">{ROTULO_FONTE[a.fonte] ?? a.fonte}</span> · <span className={a.status === "ERRO" ? "font-bold text-critico" : "text-cinza"}>{ROTULO_ANALISE[a.status] ?? a.status}</span>
                {a.status === "CONCLUIDA" && <span className="text-cinza"> · {a.sugestoes} sugestão(ões)</span>}
                {a.resumo && <span className="block text-cinza">{a.resumo}</span>}
                {a.erro && <span className="block text-cinza">{a.erro}</span>}
                {(a.status === "ERRO" || a.status === "SEM_CHAVE") && <button className="text-[12px] font-bold text-azul" onClick={() => void refazer(a.id)}>Tentar de novo</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {novo && <FormCombinado titulo="Novo combinado" onFechar={() => setNovo(false)} onSalvar={async (corpo) => {
        const r = await fetch(`/api/oportunidades/${oportunidadeId}/combinados`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
        if (!r.ok) return ((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar";
        setNovo(false); await carregar(); onAtividade(); return null;
      }} />}
      {editando && <FormCombinado titulo="Ajustar e aceitar" inicial={editando} onFechar={() => setEditando(null)} onSalvar={async (corpo) => {
        const r = await fetch(`/api/combinados/${editando.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...corpo, operacao: "aceitar" }) });
        if (!r.ok) return ((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar";
        setEditando(null); await carregar(); onAtividade(); return null;
      }} />}
      {analisar && <FormAnalisar oportunidadeId={oportunidadeId} onFechar={() => setAnalisar(false)} onEnviado={async () => { setAnalisar(false); await carregar(); }} />}
    </div>
  );
}

function FormCombinado({ titulo, inicial, onFechar, onSalvar }: { titulo: string; inicial?: CombinadoDTO; onFechar: () => void; onSalvar: (corpo: Record<string, unknown>) => Promise<string | null> }) {
  const [f, setF] = useState({ descricao: inicial?.descricao ?? "", tipo: inicial?.tipo ?? "ENTREGAVEL", responsavel: inicial?.responsavel ?? "NOS", prazoEm: diaIso(inicial?.prazoEm ?? null), hora: "", pilar: inicial?.pilar ?? "" });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";
  return (
    <Dialogo titulo={titulo} onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setSalvando(true);
        const corpo = { descricao: f.descricao, tipo: f.tipo, responsavel: f.responsavel, prazoEm: f.prazoEm ? (f.hora ? `${f.prazoEm}T${f.hora}` : f.prazoEm) : null, pilar: f.pilar || null };
        setErro(await onSalvar(corpo)); setSalvando(false);
      }}>
        <label className="block"><span className={rotulo}>O que foi combinado</span><input required minLength={3} maxLength={300} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className={campo} placeholder="Ex.: Entregar o BI de vendas" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className={rotulo}>Tipo</span><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={campo}>{TIPOS_COMBINADO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_COMBINADO[t]}</option>)}</select></label>
          <label className="block"><span className={rotulo}>Quem cumpre</span><select value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })} className={campo}>{RESPONSAVEIS.map((t) => <option key={t} value={t}>{ROTULO_RESPONSAVEL[t]}</option>)}</select></label>
          <label className="block"><span className={rotulo}>Prazo</span><input type="date" value={f.prazoEm} onChange={(e) => setF({ ...f, prazoEm: e.target.value })} className={campo} /></label>
          {f.tipo === "REUNIAO"
            ? <label className="block"><span className={rotulo}>Hora</span><input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} className={campo} /></label>
            : <label className="block"><span className={rotulo}>Pilar do plano</span><select value={f.pilar} onChange={(e) => setF({ ...f, pilar: e.target.value })} className={campo}><option value="">—</option>{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}</select></label>}
        </div>
        <p className="text-[12px] text-cinza">Ao salvar: com a venda fechada vira cartão da entrega; antes disso, tarefa. Reunião com data vai para a agenda.</p>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={salvando || f.descricao.trim().length < 3}>{salvando ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </Dialogo>
  );
}

function FormAnalisar({ oportunidadeId, onFechar, onEnviado }: { oportunidadeId: string; onFechar: () => void; onEnviado: () => void }) {
  const [texto, setTexto] = useState("");
  const [fonte, setFonte] = useState("REUNIAO");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialogo titulo="Analisar transcrição ou texto" onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setEnviando(true); setErro(null);
        const r = await fetch(`/api/oportunidades/${oportunidadeId}/analisar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto, fonte }) });
        setEnviando(false);
        if (r.ok) onEnviado(); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível enviar");
      }}>
        <select value={fonte} onChange={(e) => setFonte(e.target.value)} className={campo} aria-label="O que é o texto"><option value="REUNIAO">Transcrição de reunião (Google Meet, gravação…)</option><option value="TEXTO">Outro texto (e-mail, anotação, ata)</option></select>
        <textarea required rows={12} minLength={20} maxLength={200000} value={texto} onChange={(e) => setTexto(e.target.value)} className={campo} placeholder="Cole aqui a transcrição. O agente lista o que ficou combinado, com prazo e responsável, para você aceitar." />
        <p className="text-[12px] text-cinza">No Google Meet, a transcrição fica no Google Drive do organizador (pasta Meet Recordings): abra o documento, copie tudo e cole aqui.</p>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={enviando || texto.trim().length < 20}>{enviando ? "Enviando…" : "Analisar"}</button></div>
      </form>
    </Dialogo>
  );
}
