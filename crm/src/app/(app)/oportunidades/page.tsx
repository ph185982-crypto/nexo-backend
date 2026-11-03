"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { CartaoDTO, EtapaDTO, QuadroDTO } from "@/lib/funil/quadro";
import { tipoMotivoDaEtapa } from "@/lib/funil/encerramento";
import { moeda } from "@/lib/formatar";
import { Cartao } from "@/components/cartao";
import { Painel } from "@/components/painel";
import { DialogoMotivo } from "@/components/dialogo-motivo";
import { NovaOportunidade } from "@/components/nova-oportunidade";

interface FunilItem { id: string; nome: string; padrao: boolean }

function Coluna({ etapa, ultima, selecionado, onAbrir }: { etapa: EtapaDTO; ultima: boolean; selecionado: string | null; onAbrir: (c: CartaoDTO) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });
  return (
    <section className={`relative w-[292px] flex-none pr-[22px] ${isOver ? "rounded-lg ring-2 ring-azul/60" : ""}`} aria-label={etapa.nome}>
      {!ultima && <span aria-hidden className="absolute right-0.5 top-2 text-[22px] leading-none text-linha">›</span>}
      <header className="mb-2.5 flex items-start justify-between pr-2.5">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.04em]">{etapa.nome}</h3>
          <span className="text-[12px] text-cinza">{moeda(etapa.total)}</span>
        </div>
        <span className="grid h-[22px] min-w-[26px] place-items-center rounded-full border border-linha bg-superficie px-1 text-[11px] font-semibold">{etapa.quantidade}</span>
      </header>
      <div ref={setNodeRef} className="min-h-[120px]">
        {etapa.oportunidades.map((c) => <Cartao key={c.id} c={c} selecionado={selecionado === c.id} onAbrir={() => onAbrir(c)} />)}
        {etapa.quantidade === 0 && (
          <>
            {etapa.descricao && (
              <div className="rounded-[10px] border-[1.5px] border-dashed border-linha p-3 text-[11.5px] leading-normal text-cinza">
                <i className="mb-1 block font-titulo text-[11px] font-bold not-italic text-grafite">Descrição</i>
                {etapa.descricao}
              </div>
            )}
            <p className="mt-9 text-center text-[12px] text-cinza">Etapa vazia</p>
          </>
        )}
      </div>
    </section>
  );
}

/** Aparece só durante o arrasto: Ganha e Perdida sempre ao alcance, mesmo com o painel aberto. */
function ZonasFinais({ etapas }: { etapas: EtapaDTO[] }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-[232px] z-40 flex justify-center gap-4 px-6" style={{ right: 0 }}>
      {etapas.map((e) => <ZonaFixa key={e.id} etapa={e} />)}
    </div>
  );
}

function ZonaFixa({ etapa }: { etapa: EtapaDTO }) {
  const { setNodeRef, isOver } = useDroppable({ id: `final:${etapa.id}` });
  return (
    <div
      ref={setNodeRef}
      className={`pointer-events-auto w-60 rounded-xl border-2 border-dashed px-4 py-4 text-center text-[13px] font-bold ${isOver ? "border-azul bg-azul text-bq" : "border-azul bg-superficie text-azul"}`}
    >
      Soltar em: {etapa.nome}
    </div>
  );
}

function Finalizadas({ quadro, selecionado, onAbrir }: { quadro: QuadroDTO; selecionado: string | null; onAbrir: (c: CartaoDTO) => void }) {
  const [ano, mes] = quadro.finalizadas.mes.split("-");
  const nomeMes = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return (
    <section className="w-[292px] flex-none border-l border-linha pl-5" aria-label="Finalizadas no mês">
      <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.04em]">Finalizadas em {nomeMes}</h3>
      {quadro.finalizadas.etapas.map((e) => <Zona key={e.id} etapa={e} selecionado={selecionado} onAbrir={onAbrir} />)}
    </section>
  );
}

function Zona({ etapa, selecionado, onAbrir }: { etapa: EtapaDTO; selecionado: string | null; onAbrir: (c: CartaoDTO) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });
  return (
    <div ref={setNodeRef} className={`mb-4 min-h-[88px] rounded-[10px] border border-dashed p-2 ${isOver ? "border-azul bg-azul-8" : "border-linha"}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[12px] font-bold">{etapa.nome}</span>
        <span className="text-[12px] text-cinza">{etapa.quantidade} · {moeda(etapa.total)}</span>
      </div>
      {etapa.oportunidades.map((c) => <Cartao key={c.id} c={c} selecionado={selecionado === c.id} onAbrir={() => onAbrir(c)} />)}
    </div>
  );
}

export default function OportunidadesPage() {
  const [funis, setFunis] = useState<FunilItem[]>([]);
  const [funilId, setFunilId] = useState<string>("");
  const [quadro, setQuadro] = useState<QuadroDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<CartaoDTO | null>(null);
  const [pendente, setPendente] = useState<{ cartao: CartaoDTO; etapa: EtapaDTO } | null>(null);
  const [nova, setNova] = useState(false);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));

  useEffect(() => {
    fetch("/api/funis").then((r) => r.json()).then((j: { funis: FunilItem[] }) => {
      setFunis(j.funis);
      setFunilId((atual) => atual || (j.funis.find((f) => f.padrao) ?? j.funis[0])?.id || "");
    }).catch(() => setErro("Não foi possível carregar os funis"));
  }, []);

  const carregar = useCallback(async () => {
    if (!funilId) return;
    const r = await fetch(`/api/quadro?funilId=${funilId}`);
    if (!r.ok) { setErro("Não foi possível carregar o quadro"); return; }
    setErro(null);
    setQuadro(await r.json());
  }, [funilId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const todasEtapas = useMemo(() => (quadro ? [...quadro.etapas, ...quadro.finalizadas.etapas] : []), [quadro]);
  const cartoes = useMemo(() => todasEtapas.flatMap((e) => e.oportunidades), [todasEtapas]);
  const selecionado = cartoes.find((c) => c.id === aberto) ?? null;
  const totalAndamento = quadro?.etapas.reduce((s, e) => s + e.quantidade, 0) ?? 0;

  const mover = async (cartao: CartaoDTO, etapaId: string, motivoId: string | null = null, motivoDetalhe: string | null = null) => {
    const r = await fetch(`/api/oportunidades/${cartao.id}/mover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etapaId, motivoId, motivoDetalhe }) });
    if (!r.ok) setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível mover");
    await carregar();
  };

  // Caminho único para arrastar ou escolher no painel: etapa final pergunta o motivo antes.
  const pedirMover = (cartao: CartaoDTO, etapaId: string) => {
    const destino = todasEtapas.find((x) => x.id === etapaId);
    if (!destino || destino.id === cartao.etapaId) return;
    if (tipoMotivoDaEtapa(destino.tipo)) setPendente({ cartao, etapa: destino });
    else void mover(cartao, destino.id);
  };

  const aoSoltar = (e: DragEndEvent) => {
    setArrastando(null);
    const cartao = (e.active.data.current as { cartao: CartaoDTO } | undefined)?.cartao;
    if (!cartao || !e.over) return;
    pedirMover(cartao, String(e.over.id).replace(/^final:/, ""));
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3.5 px-6 py-3.5">
          <button onClick={() => setNova(true)} disabled={!funilId} aria-label="Nova oportunidade" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-azul text-[20px] font-bold leading-none text-bq disabled:opacity-50">+</button>
          <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Oportunidades</h1>
        </header>

        <div className="mx-6 flex items-center gap-2 rounded-xl border border-linha bg-superficie px-3 py-2">
          <label className="flex items-center font-titulo text-[13px] font-extrabold">
            <span className="font-extrabold text-azul" aria-hidden>[</span>
            <select value={funilId} onChange={(e) => { setFunilId(e.target.value); setAberto(null); setQuadro(null); }} aria-label="Funil" className="cursor-pointer bg-transparent px-1 uppercase">
              {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            <span className="font-extrabold text-azul" aria-hidden>]</span>
          </label>
        </div>

        {erro && <p role="alert" className="mx-6 mt-3 text-[13px] font-semibold text-critico">{erro}</p>}

        <div className="flex-1 overflow-auto px-6 pb-6 pt-3.5">
          {!quadro ? (
            <p className="text-cinza">{funilId ? "Carregando…" : "Nenhum funil configurado. Rode o seed (npm run db:seed)."}</p>
          ) : (
            <DndContext sensors={sensores} onDragStart={(e: DragStartEvent) => setArrastando((e.active.data.current as { cartao: CartaoDTO }).cartao)} onDragEnd={aoSoltar} onDragCancel={() => setArrastando(null)}>
              <p className="mb-2.5 font-titulo text-[13px] font-bold">Em andamento <small className="font-texto text-[12px] font-normal text-cinza">({totalAndamento})</small></p>
              <div className="flex min-w-max items-start">
                {quadro.etapas.map((e, i) => <Coluna key={e.id} etapa={e} ultima={i === quadro.etapas.length - 1} selecionado={aberto} onAbrir={(c) => setAberto(c.id)} />)}
                <Finalizadas quadro={quadro} selecionado={aberto} onAbrir={(c) => setAberto(c.id)} />
              </div>
              <DragOverlay>{arrastando && <Cartao c={arrastando} sobreposto />}</DragOverlay>
              {arrastando && <ZonasFinais etapas={quadro.finalizadas.etapas} />}
            </DndContext>
          )}
        </div>
      </div>

      {selecionado && <Painel c={selecionado} etapaNome={todasEtapas.find((e) => e.id === selecionado.etapaId)?.nome ?? ""} etapas={todasEtapas} onMover={(etapaId) => pedirMover(selecionado, etapaId)} onFechar={() => setAberto(null)} />}

      {pendente && (
        <DialogoMotivo
          nomeOportunidade={pendente.cartao.nome}
          etapa={pendente.etapa}
          onCancelar={() => setPendente(null)}
          onConfirmar={(motivoId, detalhe) => { const p = pendente; setPendente(null); void mover(p.cartao, p.etapa.id, motivoId, detalhe); }}
        />
      )}
      {nova && <NovaOportunidade funilId={funilId} onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />}
    </div>
  );
}
