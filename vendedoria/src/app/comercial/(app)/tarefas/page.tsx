"use client";

import { useCallback, useEffect, useState } from "react";
import { NovaTarefa } from "@/components/comercial/form-tarefa";
import { TarefaItem, type TarefaDTO } from "@/components/comercial/tarefa-item";
import { apiUrl } from "@/lib/api-url";

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
    const r = await fetch(apiUrl(`/api/comercial/tarefas?visao=${visao}&responsavel=${escopo}`));
    if (r.ok) setDados(await r.json());
  }, [visao, escopo]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3.5 px-4 py-3.5 sm:px-6">
        <button onClick={() => setNova(true)} aria-label="Nova tarefa" className="grid h-[34px] w-[34px] place-items-center rounded-md bg-primary text-[20px] font-bold leading-none text-primary-foreground">+</button>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Tarefas</h1>
        <div className="ml-auto flex overflow-hidden rounded-full border border-border bg-card text-[12px] font-semibold">
          {(["eu", "todos"] as const).map((e) => (
            <button key={e} onClick={() => setEscopo(e)} aria-pressed={escopo === e} className={`px-4 py-1.5 ${escopo === e ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{e === "eu" ? "Minhas" : "Todas"}</button>
          ))}
        </div>
      </header>
      <div className="mx-4 flex min-h-0 flex-1 flex-col gap-3 pb-6 sm:mx-6 sm:flex-row sm:gap-4">
        <nav className="flex flex-none gap-1 overflow-x-auto sm:block sm:w-52 sm:space-y-1" aria-label="Visões">
          {VISOES.map((v) => (
            <button key={v.id} onClick={() => setVisao(v.id)} aria-current={visao === v.id ? "true" : undefined}
              className={`flex flex-none items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2.5 sm:w-full text-left text-[13px] font-semibold ${visao === v.id ? "bg-secondary text-foreground" : "text-foreground hover:bg-card"}`}>
              {v.rotulo}
              <span className={`rounded-full px-2 text-[11px] ${v.id === "atrasadas" && (dados?.contadores[v.id] ?? 0) > 0 ? "bg-destructive font-bold text-destructive-foreground" : "bg-card text-muted-foreground"}`}>{dados?.contadores[v.id] ?? "–"}</span>
            </button>
          ))}
        </nav>
        <section className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-border bg-card px-4 sm:px-5">
          {!dados && <p className="py-10 text-center text-muted-foreground">Carregando…</p>}
          {dados && dados.tarefas.length === 0 && <p className="py-10 text-center text-muted-foreground">Nada por aqui.</p>}
          <ul>{dados?.tarefas.map((t) => <TarefaItem key={t.id} t={t} onMudou={carregar} />)}</ul>
        </section>
      </div>
      {nova && <NovaTarefa onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />}
    </div>
  );
}
