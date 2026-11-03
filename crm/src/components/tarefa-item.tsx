"use client";

import { ROTULO_PRIORIDADE, ROTULO_RECORRENCIA, ROTULO_TIPO_TAREFA, prazoTexto } from "@/lib/formatar-atividades";

export interface TarefaDTO {
  id: string; titulo: string; tipo: string; prioridade: string; prazoEm: string | null; status: string; recorrencia: string | null;
  checklist: Array<{ texto: string; feito: boolean }>;
  contato?: { id: string; nome: string } | null; oportunidade?: { id: string; nome: string } | null; responsavel?: { nome: string } | null;
}

export function TarefaItem({ t, onMudou, mostrarVinculo = true }: { t: TarefaDTO; onMudou: () => void; mostrarVinculo?: boolean }) {
  const aberta = t.status === "ABERTA";
  const prazo = prazoTexto(t.prazoEm);
  const agir = async (acao: string) => { await fetch(`/api/tarefas/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao }) }); onMudou(); };
  const marcar = async (i: number) => {
    const checklist = t.checklist.map((c, j) => (j === i ? { ...c, feito: !c.feito } : c));
    await fetch(`/api/tarefas/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ checklist }) });
    onMudou();
  };
  return (
    <li className="flex gap-3 border-b border-linha py-3">
      <input type="checkbox" checked={!aberta} onChange={() => agir(aberta ? "concluir" : "reabrir")} aria-label={aberta ? "Concluir tarefa" : "Reabrir tarefa"} className="mt-1 h-4 w-4 flex-none accent-[var(--azul)]" />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${aberta ? "" : "text-cinza line-through"}`}>{t.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-cinza">
          <span className={aberta && prazo.atrasada ? "font-bold text-critico" : ""}>{prazo.texto}</span>
          <span>{ROTULO_TIPO_TAREFA[t.tipo] ?? t.tipo}</span>
          {t.prioridade === "ALTA" && <span className="rounded-full bg-laranja px-2 py-0.5 text-[10px] font-bold text-grafite">{ROTULO_PRIORIDADE.ALTA}</span>}
          {t.recorrencia && <span>{ROTULO_RECORRENCIA[t.recorrencia]}</span>}
          {mostrarVinculo && t.oportunidade && <span className="text-azul">{t.oportunidade.nome}</span>}
          {mostrarVinculo && !t.oportunidade && t.contato && <span className="text-azul">{t.contato.nome}</span>}
        </p>
        {t.checklist.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {t.checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={c.feito} onChange={() => marcar(i)} disabled={!aberta} className="h-3.5 w-3.5 accent-[var(--azul)]" aria-label={c.texto} />
                <span className={c.feito ? "text-cinza line-through" : ""}>{c.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {aberta && <button onClick={() => agir("cancelar")} aria-label="Cancelar tarefa" className="h-6 flex-none rounded px-1.5 text-[16px] leading-none text-cinza hover:bg-bq">×</button>}
    </li>
  );
}
