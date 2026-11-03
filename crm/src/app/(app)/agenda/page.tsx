"use client";

import { useCallback, useEffect, useState } from "react";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "@/components/dialogo";
import { localParaIso } from "@/lib/formatar-atividades";

interface Comp { id: string; assunto: string; tipo: string; inicio: string; fim: string; local: string | null; status: string; contato: { nome: string } | null; oportunidade: { nome: string } | null }

const inicioDaSemana = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function AgendaPage() {
  const [base, setBase] = useState(() => inicioDaSemana(new Date()));
  const [itens, setItens] = useState<Comp[] | null>(null);
  const [escopo, setEscopo] = useState<"eu" | "todos">("eu");
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<Comp | null>(null);

  const carregar = useCallback(async () => {
    const fim = new Date(base); fim.setDate(fim.getDate() + 7);
    const r = await fetch(`/api/compromissos?de=${base.toISOString()}&ate=${fim.toISOString()}&responsavel=${escopo}`);
    if (r.ok) setItens((await r.json()).compromissos);
  }, [base, escopo]);
  useEffect(() => { setItens(null); void carregar(); }, [carregar]);

  const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return d; });
  const hoje = new Date().toDateString();
  const mover = (n: number) => setBase((b) => { const d = new Date(b); d.setDate(d.getDate() + n * 7); return d; });
  const titulo = `${dias[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${dias[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3.5 px-6 py-3.5">
        <button onClick={() => setNovo(true)} aria-label="Novo compromisso" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-azul text-[20px] font-bold leading-none text-bq">+</button>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Agenda</h1>
        <div className="ml-4 flex items-center gap-2 text-[13px] font-semibold">
          <button onClick={() => mover(-1)} aria-label="Semana anterior" className="rounded-lg border border-linha bg-superficie px-2.5 py-1">‹</button>
          <button onClick={() => setBase(inicioDaSemana(new Date()))} className="rounded-lg border border-linha bg-superficie px-3 py-1">Hoje</button>
          <button onClick={() => mover(1)} aria-label="Próxima semana" className="rounded-lg border border-linha bg-superficie px-2.5 py-1">›</button>
          <span className="ml-2 text-cinza">{titulo}</span>
        </div>
        <div className="ml-auto flex overflow-hidden rounded-full border border-linha bg-superficie text-[12px] font-semibold">
          {(["eu", "todos"] as const).map((e) => <button key={e} onClick={() => setEscopo(e)} aria-pressed={escopo === e} className={`px-4 py-1.5 ${escopo === e ? "bg-azul text-bq" : "text-cinza"}`}>{e === "eu" ? "Meus" : "Todos"}</button>)}
        </div>
      </header>
      <div className="mx-6 grid flex-1 grid-cols-7 gap-2 overflow-auto pb-6">
        {dias.map((d) => {
          const doDia = itens?.filter((c) => new Date(c.inicio).toDateString() === d.toDateString()) ?? [];
          return (
            <section key={d.toISOString()} aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric" })} className={`min-w-[130px] rounded-xl border bg-superficie p-2 ${d.toDateString() === hoje ? "border-azul" : "border-linha"}`}>
              <h3 className={`mb-2 px-1 text-[12px] font-bold ${d.toDateString() === hoje ? "text-azul" : ""}`}>{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })}</h3>
              {itens === null && <p className="px-1 text-[11px] text-cinza">…</p>}
              {doDia.map((c) => (
                <button key={c.id} onClick={() => setAberto(c)} className={`mb-1.5 block w-full rounded-lg bg-azul-8 px-2 py-1.5 text-left ${c.status === "REALIZADO" ? "opacity-60" : ""}`}>
                  <span className="block text-[11px] font-bold text-azul">{hora(c.inicio)}–{hora(c.fim)}</span>
                  <span className={`block text-[12px] font-semibold leading-tight ${c.status === "REALIZADO" ? "line-through" : ""}`}>{c.assunto}</span>
                  {(c.contato || c.oportunidade) && <span className="block truncate text-[11px] text-cinza">{c.oportunidade?.nome ?? c.contato?.nome}</span>}
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {novo && <NovoCompromisso dia={base} onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void carregar(); }} />}
      {aberto && <DetalheCompromisso c={aberto} onFechar={() => setAberto(null)} onMudou={() => { setAberto(null); void carregar(); }} />}
    </div>
  );
}

function NovoCompromisso({ dia, onFechar, onCriado }: { dia: Date; onFechar: () => void; onCriado: () => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const padrao = (h: number) => `${dia.getFullYear()}-${pad(dia.getMonth() + 1)}-${pad(dia.getDate())}T${pad(h)}:00`;
  const [assunto, setAssunto] = useState(""); const [tipo, setTipo] = useState("REUNIAO");
  const [inicio, setInicio] = useState(padrao(9)); const [fim, setFim] = useState(padrao(10));
  const [local, setLocal] = useState(""); const [participantes, setParticipantes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null);
    const r = await fetch("/api/compromissos", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ assunto, tipo, inicio: localParaIso(inicio), fim: localParaIso(fim), local, participantes: participantes.split(/[\s,;]+/).filter(Boolean) }) });
    if (r.ok) onCriado(); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível criar");
  };
  return (
    <Dialogo titulo="Novo compromisso" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Assunto</span><input required maxLength={200} value={assunto} onChange={(e) => setAssunto(e.target.value)} className={campo} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Início</span><input type="datetime-local" required value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} /></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Fim</span><input type="datetime-local" required value={fim} onChange={(e) => setFim(e.target.value)} className={campo} /></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>{["REUNIAO", "LIGACAO", "VISITA", "OUTRO"].map((t) => <option key={t} value={t}>{{ REUNIAO: "Reunião", LIGACAO: "Ligação", VISITA: "Visita", OUTRO: "Outro" }[t]}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Local</span><input maxLength={200} value={local} onChange={(e) => setLocal(e.target.value)} className={campo} /></label>
        </div>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Participantes (e-mails)</span><input value={participantes} onChange={(e) => setParticipantes(e.target.value)} className={campo} placeholder="a@empresa.com, b@empresa.com" /></label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!assunto.trim()}>Criar</button></div>
      </form>
    </Dialogo>
  );
}

function DetalheCompromisso({ c, onFechar, onMudou }: { c: Comp; onFechar: () => void; onMudou: () => void }) {
  const marcar = async (status: string) => { await fetch(`/api/compromissos/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); onMudou(); };
  return (
    <Dialogo titulo={c.assunto} onFechar={onFechar}>
      <p className="mb-1 text-[13px]">{new Date(c.inicio).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}, {hora(c.inicio)}–{hora(c.fim)}</p>
      {c.local && <p className="text-[13px] text-cinza">{c.local}</p>}
      {(c.oportunidade || c.contato) && <p className="text-[13px] font-semibold text-azul">{c.oportunidade?.nome ?? c.contato?.nome}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className={botaoSecundario} onClick={() => marcar("CANCELADO")}>Cancelar compromisso</button>
        {c.status !== "REALIZADO" && <button className={botaoPrimario} onClick={() => marcar("REALIZADO")}>Marcar como realizado</button>}
      </div>
    </Dialogo>
  );
}
