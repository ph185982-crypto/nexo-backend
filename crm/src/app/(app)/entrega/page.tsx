"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SaudeChip } from "@/components/saude-chip";
import { moeda } from "@/lib/formatar";
import { ROTULO_STATUS_ENTREGA, STATUS_ENTREGA } from "@/lib/entrega/constantes";
import type { RotuloSaudeEntrega } from "@/lib/entrega/saude";

interface Item {
  id: string; nome: string; status: string; contato: { id: string; nome: string }; renovacaoEm: string | null; valorMensal: number;
  saude: { nota: number; rotulo: RotuloSaudeEntrega; progresso: number; total: number; concluidos: number; atrasados: number; diasParaRenovar: number | null; renovacaoProxima: boolean };
}

export default function EntregasPage() {
  const [status, setStatus] = useState<string>("EM_ANDAMENTO");
  const [itens, setItens] = useState<Item[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setItens(null);
    fetch(`/api/entregas?status=${status}`).then((r) => r.json()).then((j) => { if (vivo) setItens(j.entregas ?? []); }).catch(() => { if (vivo) setItens([]); });
    return () => { vivo = false; };
  }, [status]);

  const mrr = itens?.reduce((s, i) => s + i.valorMensal, 0) ?? 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 px-6 py-3.5">
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Entrega</h1>
        {itens && status === "EM_ANDAMENTO" && <span className="text-[13px] text-cinza">{itens.length} cliente(s) · receita mensal <b className="text-grafite">{moeda(mrr)}</b></span>}
        <div className="ml-auto flex overflow-hidden rounded-full border border-linha bg-superficie text-[12px] font-semibold">
          {STATUS_ENTREGA.map((s) => <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`px-3.5 py-1.5 ${status === s ? "bg-azul text-bq" : "text-cinza"}`}>{ROTULO_STATUS_ENTREGA[s]}</button>)}
        </div>
      </header>
      <div className="flex-1 overflow-auto px-6 pb-6">
        {itens === null && <p className="py-10 text-center text-cinza">Carregando…</p>}
        {itens?.length === 0 && <p className="py-10 text-center text-cinza">Nenhuma entrega {ROTULO_STATUS_ENTREGA[status as keyof typeof ROTULO_STATUS_ENTREGA].toLowerCase()}. A entrega abre sozinha quando uma oportunidade é ganha.</p>}
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {itens?.map((i) => (
            <li key={i.id}>
              <Link href={`/entrega/${i.id}`} className="block rounded-xl border border-linha bg-superficie p-4 hover:border-azul">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-titulo text-[15px] font-extrabold">{i.contato.nome}</p>
                    <p className="truncate text-[12px] text-cinza">{i.nome}</p>
                  </div>
                  <SaudeChip rotulo={i.saude.rotulo} nota={i.saude.nota} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bq" role="progressbar" aria-valuenow={i.saude.progresso} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da entrega"><div className="h-full bg-azul" style={{ width: `${i.saude.progresso}%` }} /></div>
                  <span className="text-[12px] font-semibold">{i.saude.concluidos}/{i.saude.total}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-cinza">
                  {i.valorMensal > 0 && <span>{moeda(i.valorMensal)}/mês</span>}
                  {i.saude.atrasados > 0 && <span className="font-bold text-critico">{i.saude.atrasados} atrasado(s)</span>}
                  {i.renovacaoEm && (i.saude.renovacaoProxima
                    ? <span className="rounded-full bg-laranja px-2 py-0.5 font-bold text-grafite">Renova em {Math.max(0, i.saude.diasParaRenovar ?? 0)} dia(s)</span>
                    : <span>Renova em {new Date(i.renovacaoEm).toLocaleDateString("pt-BR")}</span>)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
