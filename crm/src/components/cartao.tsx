"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CartaoDTO } from "@/lib/funil/quadro";
import { diasDesde } from "@/lib/funil/encerramento";
import { data, moeda, nivelParado } from "@/lib/formatar";

function Indicador({ dias, titulo, avaliar }: { dias: number; titulo: string; avaliar: boolean }) {
  const nivel = avaliar ? nivelParado(dias) : "ok";
  return (
    <span
      title={titulo}
      className={`flex items-center gap-1 text-[11px] ${nivel === "ok" ? "font-semibold text-cinza" : nivel === "critico" ? "font-bold text-critico" : "font-bold text-grafite"}`}
    >
      {nivel !== "ok" && <i className={`inline-block h-2 w-2 rounded-full ${nivel === "critico" ? "bg-critico" : "bg-laranja"}`} aria-hidden />}
      {dias}d
    </span>
  );
}

export function Cartao({ c, selecionado, onAbrir, sobreposto }: { c: CartaoDTO; selecionado?: boolean; onAbrir?: () => void; sobreposto?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id, data: { cartao: c } });
  const aberta = c.status === "EM_ANDAMENTO";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onAbrir}
      className={`mb-2.5 cursor-grab rounded-[10px] border bg-superficie px-3.5 pt-3 active:cursor-grabbing ${selecionado ? "border-azul ring-1 ring-azul" : "border-linha"} ${isDragging ? "opacity-40" : ""} ${sobreposto ? "rotate-1 shadow-xl" : ""}`}
    >
      {c.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {c.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-azul-8 px-2 py-0.5 text-[10px] font-semibold text-azul">#{t}</span>)}
        </div>
      )}
      <p className="text-[13px] font-semibold leading-tight">{c.nome}</p>
      <p className="mb-2 mt-0.5 text-[12px] font-semibold text-azul">{c.contato.nome}</p>
      <p className="text-[11.5px] leading-[1.55] text-cinza">
        {c.codigo}
        <br />
        Criada {data(c.criadoEm)}{c.finalizaEm ? ` · Finaliza ${data(c.finalizaEm)}` : ""}
      </p>
      {!aberta && (
        <p className="mt-1 truncate text-[11.5px] text-cinza" title={c.motivoDetalhe ?? undefined}>
          {c.motivo ? `Motivo: ${c.motivo}` : "Sem motivo registrado"}
        </p>
      )}
      <div className="-mx-3.5 mt-2.5 flex items-center justify-between border-t border-linha px-3.5 py-2">
        <b className="text-[12px]">{moeda(c.valorTotal)}</b>
        {aberta && (
          <div className="flex gap-2.5">
            <Indicador dias={diasDesde(c.etapaDesdeEm)} titulo="Dias nesta etapa" avaliar />
            <Indicador dias={diasDesde(c.criadoEm)} titulo="Idade da oportunidade" avaliar={false} />
            <Indicador dias={diasDesde(c.ultimaAtividadeEm)} titulo="Dias sem atividade" avaliar />
          </div>
        )}
      </div>
    </div>
  );
}
