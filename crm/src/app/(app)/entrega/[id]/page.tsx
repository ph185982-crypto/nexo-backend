"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "@/components/dialogo";
import { SaudeChip } from "@/components/saude-chip";
import { moeda } from "@/lib/formatar";
import { COLUNAS, PILARES, ROTULO_COLUNA, ROTULO_PILAR, ROTULO_STATUS_ENTREGA, STATUS_ENTREGA, type Coluna, type Pilar } from "@/lib/entrega/constantes";
import type { RotuloSaudeEntrega } from "@/lib/entrega/saude";

interface Cartao { id: string; titulo: string; descricao: string | null; pilar: Pilar; coluna: Coluna; ordem: number; dataAlvo: string | null; cliente: boolean; checklist: Array<{ texto: string; feito: boolean }> }
interface Detalhe {
  id: string; nome: string; status: string; renovacaoEm: string | null; valorMensal: number; oportunidadeId: string; diagnostico: Record<string, string>;
  concluidaEm: string | null; renovacaoOportunidadeId: string | null;
  contato: { id: string; nome: string }; cartoes: Cartao[];
  saude: { nota: number; rotulo: RotuloSaudeEntrega; progresso: number; total: number; concluidos: number; atrasados: number; esperandoCliente: number };
}

const diaIso = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const prazo = (iso: string | null, fechado: boolean) => {
  if (!iso) return null;
  const atrasado = !fechado && new Date(iso).getTime() < Date.now();
  return { texto: new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), atrasado };
};

function CartaoEntrega({ c, onAbrir, sobreposto }: { c: Cartao; onAbrir?: () => void; sobreposto?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id, data: { c } });
  const p = prazo(c.dataAlvo, c.coluna === "CONCLUIDO");
  const feitos = c.checklist.filter((i) => i.feito).length;
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onAbrir}
      className={`mb-2 cursor-grab rounded-[10px] border border-linha bg-superficie px-3 py-2.5 active:cursor-grabbing ${isDragging ? "opacity-40" : ""} ${sobreposto ? "rotate-1 shadow-xl" : ""}`}>
      <div className="mb-1.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-azul-8 px-2 py-0.5 text-[10px] font-semibold text-azul">{ROTULO_PILAR[c.pilar]}</span>
        {c.cliente && <span className="rounded-full border border-linha px-2 py-0.5 text-[10px] font-semibold text-cinza">Cliente</span>}
      </div>
      <p className={`text-[13px] font-semibold leading-tight ${c.coluna === "CONCLUIDO" ? "text-cinza line-through" : ""}`}>{c.titulo}</p>
      <p className="mt-1.5 flex items-center gap-3 text-[11.5px] text-cinza">
        {p && <span className={p.atrasado ? "font-bold text-critico" : ""}>{p.atrasado ? "Atrasado · " : ""}{p.texto}</span>}
        {c.checklist.length > 0 && <span>{feitos}/{c.checklist.length}</span>}
      </p>
    </div>
  );
}

function ColunaEntrega({ coluna, cartoes, onAbrir }: { coluna: Coluna; cartoes: Cartao[]; onAbrir: (c: Cartao) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna });
  return (
    <section aria-label={ROTULO_COLUNA[coluna]} className={`w-[250px] flex-none rounded-xl p-2 ${isOver ? "bg-azul-8 ring-2 ring-azul/50" : ""}`}>
      <h3 className="mb-2 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-[0.04em]">{ROTULO_COLUNA[coluna]}<span className="rounded-full border border-linha bg-superficie px-2 py-0.5 text-[11px] font-semibold normal-case">{cartoes.length}</span></h3>
      <div ref={setNodeRef} className="min-h-[100px]">{cartoes.map((c) => <CartaoEntrega key={c.id} c={c} onAbrir={() => onAbrir(c)} />)}</div>
    </section>
  );
}

export default function EntregaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detalhe | null | "nao-encontrada">(null);
  const [aba, setAba] = useState<"cartoes" | "diagnostico">("cartoes");
  const [pilar, setPilar] = useState<Pilar | "">("");
  const [editando, setEditando] = useState<Cartao | "novo" | null>(null);
  const [arrastando, setArrastando] = useState<Cartao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/entregas/${id}`);
    if (r.status === 404) { setD("nao-encontrada"); return; }
    if (r.ok) setD(await r.json());
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const patch = async (corpo: unknown) => {
    const r = await fetch(`/api/entregas/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar"); else setErro(null);
    await carregar();
  };

  const visiveis = useMemo(() => (d && d !== "nao-encontrada" ? d.cartoes.filter((c) => !pilar || c.pilar === pilar) : []), [d, pilar]);

  const aoSoltar = async (e: DragEndEvent) => {
    setArrastando(null);
    const c = (e.active.data.current as { c: Cartao } | undefined)?.c;
    if (!c || !e.over || String(e.over.id) === c.coluna) return;
    const r = await fetch(`/api/entregas/${id}/cartoes/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ coluna: String(e.over.id) }) });
    if (!r.ok) setErro("Não foi possível mover o cartão");
    await carregar();
  };

  const upsell = async () => {
    const r = await fetch(`/api/entregas/${id}/upsell`, { method: "POST" });
    if (r.ok) router.push("/oportunidades"); else setErro("Não foi possível abrir o upsell");
  };

  if (d === null) return <p className="p-8 text-cinza">Carregando…</p>;
  if (d === "nao-encontrada") return <p className="p-8 text-cinza">Entrega não encontrada.</p>;

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pb-2 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => router.push("/entrega")} aria-label="Voltar" className="rounded-lg border border-linha bg-superficie px-2.5 py-1 text-[14px]">‹</button>
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-extrabold leading-tight tracking-tight">{d.contato.nome}</h1>
            <p className="truncate text-[12px] text-cinza">{d.nome}{d.valorMensal > 0 ? ` · ${moeda(d.valorMensal)}/mês` : ""}</p>
          </div>
          <SaudeChip rotulo={d.saude.rotulo} nota={d.saude.nota} />
          <span className="text-[12px] text-cinza">{d.saude.concluidos}/{d.saude.total} concluídos{d.saude.atrasados > 0 && <b className="ml-2 text-critico">{d.saude.atrasados} atrasado(s)</b>}{d.saude.esperandoCliente > 0 && <b className="ml-2 text-grafite">{d.saude.esperandoCliente} esperando o cliente</b>}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
            <label className="flex items-center gap-1.5 font-semibold text-cinza">Status
              <select value={d.status} onChange={(e) => patch({ status: e.target.value })} className="rounded-lg border border-linha bg-superficie px-2 py-1 text-grafite">{STATUS_ENTREGA.map((s) => <option key={s} value={s}>{ROTULO_STATUS_ENTREGA[s]}</option>)}</select></label>
            <label className="flex items-center gap-1.5 font-semibold text-cinza">Renovação
              <input type="date" value={diaIso(d.renovacaoEm)} onChange={(e) => patch({ renovacaoEm: e.target.value || null })} className="rounded-lg border border-linha bg-superficie px-2 py-1 text-grafite" /></label>
            <button onClick={upsell} className={botaoSecundario}>Abrir upsell</button>
          </div>
          {(d.concluidaEm || (d.renovacaoOportunidadeId && !d.renovacaoOportunidadeId.startsWith("reservando:"))) && (
            <p className="w-full text-[12px] text-cinza" role="status">
              {d.concluidaEm && <>Concluída em {new Date(d.concluidaEm).toLocaleDateString("pt-BR")}. </>}
              {d.renovacaoOportunidadeId && !d.renovacaoOportunidadeId.startsWith("reservando:") && <>A rotina já abriu a <b className="text-grafite">oportunidade de renovação</b> no funil de vendas, com tarefa para preparar a proposta.</>}
            </p>
          )}
        </div>
        {erro && <p role="alert" className="mt-2 text-[13px] font-semibold text-critico">{erro}</p>}
        <div role="tablist" className="mt-3 flex items-center gap-5 border-b border-linha">
          {([["cartoes", "Cartões"], ["diagnostico", "Diagnóstico"]] as const).map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 py-2 text-[13px] font-semibold ${aba === k ? "border-azul text-azul" : "border-transparent text-cinza"}`}>{r}</button>)}
          {aba === "cartoes" && (
            <div className="ml-auto flex items-center gap-2 pb-1">
              <select value={pilar} onChange={(e) => setPilar(e.target.value as Pilar | "")} aria-label="Filtrar por pilar" className="rounded-lg border border-linha bg-superficie px-2 py-1 text-[12px]"><option value="">Todos os pilares</option>{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}</select>
              <button onClick={() => setEditando("novo")} className={botaoPrimario}>Novo cartão</button>
            </div>
          )}
        </div>
      </header>

      {aba === "cartoes" ? (
        <div className="flex-1 overflow-auto px-6 pb-6 pt-3">
          <DndContext sensors={sensores} onDragStart={(e) => setArrastando((e.active.data.current as { c: Cartao }).c)} onDragEnd={aoSoltar} onDragCancel={() => setArrastando(null)}>
            <div className="flex min-w-max gap-3">{COLUNAS.map((col) => <ColunaEntrega key={col} coluna={col} cartoes={visiveis.filter((c) => c.coluna === col)} onAbrir={setEditando} />)}</div>
            <DragOverlay>{arrastando && <CartaoEntrega c={arrastando} sobreposto />}</DragOverlay>
          </DndContext>
        </div>
      ) : (
        <Diagnostico diagnostico={d.diagnostico} onSalvar={(diag) => patch({ diagnostico: diag })} />
      )}

      {editando && <EditarCartao entregaId={id} cartao={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />}
    </div>
  );
}

function Diagnostico({ diagnostico, onSalvar }: { diagnostico: Record<string, string>; onSalvar: (d: Record<string, string>) => Promise<void> }) {
  const [v, setV] = useState<Record<string, string>>(diagnostico);
  const [salvo, setSalvo] = useState(false);
  return (
    <div className="flex-1 overflow-auto px-6 pb-8 pt-4">
      <p className="mb-4 max-w-2xl text-[13px] text-cinza">O que foi encontrado em cada pilar. Escreva o problema, a evidência e a decisão necessária; os cartões da entrega saem daqui.</p>
      <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
        {PILARES.map((p) => (
          <label key={p} className="block"><span className="mb-1 block font-titulo text-[13px] font-bold">{ROTULO_PILAR[p]}</span>
            <textarea rows={5} maxLength={5000} value={v[p] ?? ""} onChange={(e) => { setV({ ...v, [p]: e.target.value }); setSalvo(false); }} className={campo} /></label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3"><button className={botaoPrimario} onClick={async () => { await onSalvar(v); setSalvo(true); }}>Salvar diagnóstico</button>{salvo && <span className="text-[12px] font-semibold text-ok" role="status">Salvo</span>}</div>
    </div>
  );
}

function EditarCartao({ entregaId, cartao, onFechar, onSalvo }: { entregaId: string; cartao: Cartao | null; onFechar: () => void; onSalvo: () => void }) {
  const [titulo, setTitulo] = useState(cartao?.titulo ?? "");
  const [descricao, setDescricao] = useState(cartao?.descricao ?? "");
  const [pilar, setPilar] = useState<Pilar>(cartao?.pilar ?? "COMERCIAL");
  const [dataAlvo, setDataAlvo] = useState(diaIso(cartao?.dataAlvo ?? null));
  const [checklist, setChecklist] = useState((cartao?.checklist ?? []).map((i) => i.texto).join("\n"));
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null);
    const feitos = new Set((cartao?.checklist ?? []).filter((i) => i.feito).map((i) => i.texto));
    const corpo = { titulo, descricao: descricao || null, pilar, dataAlvo: dataAlvo ? new Date(`${dataAlvo}T12:00:00`).toISOString() : null, checklist: checklist.split("\n").map((t) => t.trim()).filter(Boolean).map((t) => ({ texto: t, feito: feitos.has(t) })) };
    const r = await fetch(cartao ? `/api/entregas/${entregaId}/cartoes/${cartao.id}` : `/api/entregas/${entregaId}/cartoes`, { method: cartao ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    if (r.ok) onSalvo(); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar");
  };
  const excluir = async () => { if (cartao && window.confirm("Excluir este cartão?")) { await fetch(`/api/entregas/${entregaId}/cartoes/${cartao.id}`, { method: "DELETE" }); onSalvo(); } };

  return (
    <Dialogo titulo={cartao ? "Editar cartão" : "Novo cartão"} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Título</span><input required maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Pilar</span><select value={pilar} onChange={(e) => setPilar(e.target.value as Pilar)} className={campo}>{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Data alvo</span><input type="date" value={dataAlvo} onChange={(e) => setDataAlvo(e.target.value)} className={campo} /></label>
        </div>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Descrição</span><textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Checklist (um item por linha)</span><textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} className={campo} /></label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex items-center justify-between pt-1">
          {cartao ? <button type="button" onClick={excluir} className="text-[13px] font-semibold text-critico">Excluir</button> : <span />}
          <div className="flex gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!titulo.trim()}>Salvar</button></div>
        </div>
      </form>
    </Dialogo>
  );
}
