"use client";

import { useCallback, useEffect, useState } from "react";
import { NovaTarefa } from "@/components/form-tarefa";
import { TarefaItem, type TarefaDTO } from "@/components/tarefa-item";

const VISOES = [
  { id: "hoje", rotulo: "Hoje" }, { id: "atrasadas", rotulo: "Atrasadas" }, { id: "proximos7", rotulo: "Próximos 7 dias" },
  { id: "abertas", rotulo: "Em aberto" }, { id: "concluidas", rotulo: "Concluídas" },
] as const;

export default function TarefasPage() {
  const [visao, setVisao] = useState<(typeof VISOES)[number]["id"]>("hoje");
  const [escopo, setEscopo] = useState<"eu" | "todos">("eu");
  const [dados, setDados] = useState<{ tarefas: TarefaDTO[]; contadores: Record<string, number> } | null>(null);
  const [nova, setNova] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/tarefas?visao=${visao}&responsavel=${escopo}`);
    if (r.ok) setDados(await r.json());
  }, [visao, escopo]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3.5 px-6 py-3.5">
        <button onClick={() => setNova(true)} aria-label="Nova tarefa" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-azul text-[20px] font-bold leading-none text-bq">+</button>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Tarefas</h1>
        <div className="ml-auto flex overflow-hidden rounded-full border border-linha bg-superficie text-[12px] font-semibold">
          {(["eu", "todos"] as const).map((e) => (
            <button key={e} onClick={() => setEscopo(e)} aria-pressed={escopo === e} className={`px-4 py-1.5 ${escopo === e ? "bg-azul text-bq" : "text-cinza"}`}>{e === "eu" ? "Minhas" : "Todas"}</button>
          ))}
        </div>
      </header>
      <div className="mx-6 flex min-h-0 flex-1 gap-4 pb-6">
        <nav className="w-52 flex-none space-y-1" aria-label="Visões">
          {VISOES.map((v) => (
            <button key={v.id} onClick={() => setVisao(v.id)} aria-current={visao === v.id ? "true" : undefined}
              className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-[13px] font-semibold ${visao === v.id ? "bg-azul-8 text-azul" : "text-grafite hover:bg-superficie"}`}>
              {v.rotulo}
              <span className={`rounded-full px-2 text-[11px] ${v.id === "atrasadas" && (dados?.contadores[v.id] ?? 0) > 0 ? "bg-critico font-bold text-bq" : "bg-superficie text-cinza"}`}>{dados?.contadores[v.id] ?? "–"}</span>
            </button>
          ))}
        </nav>
        <section className="min-w-0 flex-1 overflow-auto rounded-xl border border-linha bg-superficie px-5">
          {!dados && <p className="py-10 text-center text-cinza">Carregando…</p>}
          {dados && dados.tarefas.length === 0 && <p className="py-10 text-center text-cinza">Nada por aqui.</p>}
          <ul>{dados?.tarefas.map((t) => <TarefaItem key={t.id} t={t} onMudou={carregar} />)}</ul>
        </section>
      </div>
      {nova && <NovaTarefa onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />}
    </div>
  );
}
