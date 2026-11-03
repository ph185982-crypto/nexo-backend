"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { botaoPrimario, campo } from "@/components/dialogo";
import { CICLOS, ROTULO_CICLO } from "@/lib/contatos/rotulos";
import { dataHora, moeda } from "@/lib/formatar";
import { ROTULO_INTENCAO } from "@/lib/atividades/intencoes";
import { prazoTexto, ROTULO_TIPO_FEEDBACK } from "@/lib/formatar-atividades";

interface Detalhe {
  id: string; tipo: string; nome: string; telefone: string | null; email: string | null; documento: string | null; segmento: string | null; cargo: string | null; cicloDeVida: string; origem: string | null;
  empresa: { id: string; nome: string } | null; pessoas: Array<{ id: string; nome: string; telefone: string | null; cargo: string | null }>;
  oportunidades: Array<{ id: string; numero: number; nome: string; status: string; valorUnico: number; valorMensal: number; etapa: { nome: string } }>;
  tarefas: Array<{ id: string; titulo: string; prazoEm: string | null; prioridade: string }>;
  feedbacks: Array<{ id: string; tipo: string; texto: string; intencao: string | null; autorNome: string | null; criadoEm: string }>;
  entregas: Array<{ id: string; nome: string; status: string }>;
}
const STATUS: Record<string, string> = { EM_ANDAMENTO: "Em andamento", GANHA: "Ganha", PERDIDA: "Perdida" };
const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";

export default function ContatoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detalhe | null | "nao-encontrado">(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; existenteId?: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/contatos/${id}`);
    if (r.status === 404) { setD("nao-encontrado"); return; }
    if (!r.ok) return;
    const j: Detalhe = await r.json();
    setD(j); setF({ nome: j.nome, telefone: j.telefone ?? "", email: j.email ?? "", documento: j.documento ?? "", segmento: j.segmento ?? "", cargo: j.cargo ?? "", cicloDeVida: j.cicloDeVida });
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (d === null) return <p className="p-8 text-cinza">Carregando…</p>;
  if (d === "nao-encontrado") return <p className="p-8 text-cinza">Contato não encontrado. <Link href="/contatos" className="text-azul underline">Voltar</Link></p>;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    const r = await fetch(`/api/contatos/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    if (r.ok) { setMsg({ ok: true, texto: "Salvo" }); await carregar(); return; }
    const j = (await r.json().catch(() => null)) as { erro?: string; existenteId?: string } | null;
    setMsg({ ok: false, texto: j?.erro ?? "Não foi possível salvar", existenteId: j?.existenteId });
  };
  const excluir = async () => {
    if (!window.confirm(`Excluir "${d.nome}"?`)) return;
    const r = await fetch(`/api/contatos/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/contatos"); else setMsg({ ok: false, texto: ((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível excluir" });
  };

  return (
    <div className="h-full overflow-auto px-6 pb-10 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push("/contatos")} aria-label="Voltar" className="rounded-lg border border-linha bg-superficie px-2.5 py-1 text-[14px]">‹</button>
        <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">{d.nome}</h1>
        <span className="rounded-full bg-azul-8 px-2.5 py-0.5 text-[11px] font-bold text-azul">{d.tipo === "EMPRESA" ? "Empresa" : "Pessoa"}</span>
        {d.empresa && <Link href={`/contatos/${d.empresa.id}`} className="text-[13px] font-semibold text-azul">{d.empresa.nome}</Link>}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,420px)_1fr]">
        <form onSubmit={salvar} className="space-y-3 rounded-xl border border-linha bg-superficie p-4 xl:self-start">
          <label className="block"><span className={rotulo}>Nome</span><input required maxLength={200} value={f.nome ?? ""} onChange={(e) => set("nome", e.target.value)} className={campo} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={rotulo}>Telefone</span><input inputMode="tel" value={f.telefone ?? ""} onChange={(e) => set("telefone", e.target.value)} className={campo} /></label>
            <label className="block"><span className={rotulo}>E-mail</span><input type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} className={campo} /></label>
            <label className="block"><span className={rotulo}>Segmento</span><input maxLength={100} value={f.segmento ?? ""} onChange={(e) => set("segmento", e.target.value)} className={campo} /></label>
            <label className="block"><span className={rotulo}>Cargo</span><input maxLength={100} value={f.cargo ?? ""} onChange={(e) => set("cargo", e.target.value)} className={campo} /></label>
            <label className="block"><span className={rotulo}>CNPJ / CPF</span><input maxLength={30} value={f.documento ?? ""} onChange={(e) => set("documento", e.target.value)} className={campo} /></label>
            <label className="block"><span className={rotulo}>Ciclo de vida</span><select value={f.cicloDeVida} onChange={(e) => set("cicloDeVida", e.target.value)} className={campo}>{CICLOS.map((c) => <option key={c} value={c}>{ROTULO_CICLO[c]}</option>)}</select></label>
          </div>
          {d.origem && <p className="text-[12px] text-cinza">Origem: {d.origem}</p>}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-semibold ${msg.ok ? "text-ok" : "text-critico"}`}>{msg.texto}{msg.existenteId && <> <Link href={`/contatos/${msg.existenteId}`} className="underline">Abrir o outro contato</Link></>}</p>}
          <div className="flex items-center justify-between"><button type="button" onClick={excluir} className="text-[13px] font-semibold text-critico">Excluir</button><button type="submit" className={botaoPrimario}>Salvar</button></div>
        </form>

        <div className="space-y-5">
          <Bloco titulo={`Oportunidades (${d.oportunidades.length})`} vazio="Nenhuma oportunidade." vazia={d.oportunidades.length === 0}>
            {d.oportunidades.map((o) => <li key={o.id} className="flex justify-between gap-3 border-t border-linha py-2 text-[13px]"><span className="min-w-0 truncate font-semibold">{o.nome}</span><span className="flex-none text-cinza">{o.etapa.nome} · {STATUS[o.status]} · {moeda(o.valorUnico + o.valorMensal)}</span></li>)}
          </Bloco>
          {d.entregas.length > 0 && <Bloco titulo="Entregas" vazia={false}>{d.entregas.map((e) => <li key={e.id} className="border-t border-linha py-2 text-[13px]"><Link href={`/entrega/${e.id}`} className="font-semibold text-azul">{e.nome}</Link></li>)}</Bloco>}
          {d.pessoas.length > 0 && <Bloco titulo={`Pessoas (${d.pessoas.length})`} vazia={false}>{d.pessoas.map((p) => <li key={p.id} className="flex justify-between border-t border-linha py-2 text-[13px]"><Link href={`/contatos/${p.id}`} className="font-semibold text-azul">{p.nome}</Link><span className="text-cinza">{[p.cargo, p.telefone].filter(Boolean).join(" · ")}</span></li>)}</Bloco>}
          <Bloco titulo={`Tarefas abertas (${d.tarefas.length})`} vazio="Nenhuma tarefa aberta." vazia={d.tarefas.length === 0}>
            {d.tarefas.map((t) => { const p = prazoTexto(t.prazoEm); return <li key={t.id} className="flex justify-between gap-3 border-t border-linha py-2 text-[13px]"><span className="font-semibold">{t.titulo}</span><span className={p.atrasada ? "font-bold text-critico" : "text-cinza"}>{p.texto}</span></li>; })}
          </Bloco>
          <Bloco titulo="Linha do tempo" vazio="Sem interações registradas." vazia={d.feedbacks.length === 0}>
            {d.feedbacks.map((fb) => (
              <li key={fb.id} className="border-t border-linha py-2.5 text-[13px]">
                <p className="text-[11.5px] text-cinza"><b className="text-grafite">{ROTULO_TIPO_FEEDBACK[fb.tipo] ?? fb.tipo}</b> · {fb.autorNome ?? "—"} · {dataHora(fb.criadoEm)}</p>
                <p className="mt-0.5 whitespace-pre-wrap">{fb.texto}</p>
                {fb.intencao && <span className="mt-1 inline-block rounded-full bg-azul-8 px-2.5 py-0.5 text-[11px] font-semibold text-azul">{ROTULO_INTENCAO[fb.intencao as keyof typeof ROTULO_INTENCAO] ?? fb.intencao}</span>}
              </li>))}
          </Bloco>
        </div>
      </div>
    </div>
  );
}

function Bloco({ titulo, vazio, vazia, children }: { titulo: string; vazio?: string; vazia: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-linha bg-superficie p-4" aria-label={titulo}>
      <h2 className="font-titulo text-[14px] font-extrabold">{titulo}</h2>
      {vazia ? <p className="py-3 text-[13px] text-cinza">{vazio}</p> : <ul className="mt-1">{children}</ul>}
    </section>
  );
}
