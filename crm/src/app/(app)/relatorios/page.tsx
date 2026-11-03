"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { moeda, dataHora } from "@/lib/formatar";
import { campo } from "@/components/dialogo";

type Aba = "geral" | "funil" | "ganhos" | "equipe" | "metas" | "auditoria";
const ABAS: Array<[Aba, string]> = [["geral", "Visão geral"], ["funil", "Funil"], ["ganhos", "Ganhos e perdas"], ["equipe", "Equipe"], ["metas", "Metas"], ["auditoria", "Auditoria"]];
const PRESETS = [["mes", "Este mês"], ["mes-passado", "Mês passado"], ["30d", "Últimos 30 dias"], ["ano", "Este ano"], ["custom", "Personalizado"]] as const;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function intervalo(preset: string, de: string, ate: string): { de: string; ate: string } {
  const h = new Date();
  switch (preset) {
    case "mes-passado": return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
    case "30d": return { de: iso(new Date(h.getTime() - 29 * 86_400_000)), ate: iso(h) };
    case "ano": return { de: `${h.getFullYear()}-01-01`, ate: iso(h) };
    case "custom": return { de, ate };
    default: return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)) };
  }
}
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const dias = (v: number | null) => (v === null ? "—" : v < 1 ? "< 1 d" : `${v < 10 ? v.toFixed(1).replace(".", ",") : Math.round(v)} d`);

function Barra({ valor, max, cor = "bg-azul" }: { valor: number; max: number; cor?: string }) {
  return <div className="h-2 flex-1 overflow-hidden rounded-full bg-bq" role="presentation"><div className={`h-full ${cor}`} style={{ width: `${max > 0 ? Math.max(2, (valor / max) * 100) : 0}%` }} /></div>;
}
const Card = ({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) => (
  <div className="rounded-xl border border-linha bg-superficie p-4"><p className="text-[12px] font-semibold text-cinza">{rotulo}</p><p className="mt-1 font-titulo text-[24px] font-extrabold leading-none">{valor}</p>{nota && <p className="mt-1.5 text-[11.5px] text-cinza">{nota}</p>}</div>
);

export default function RelatoriosPage() {
  const [aba, setAba] = useState<Aba>("geral");
  const [preset, setPreset] = useState("mes");
  const [de, setDe] = useState(""); const [ate, setAte] = useState("");
  const [funis, setFunis] = useState<Array<{ id: string; nome: string; padrao: boolean }>>([]);
  const [funilId, setFunilId] = useState("");
  const periodo = useMemo(() => intervalo(preset, de, ate), [preset, de, ate]);

  useEffect(() => { fetch("/api/funis").then((r) => r.json()).then((j) => { setFunis(j.funis ?? []); }); }, []);
  const funilEfetivo = funilId || (aba === "funil" ? funis.find((f) => f.padrao)?.id ?? funis[0]?.id ?? "" : "");

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 py-3.5">
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Relatórios</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
          <select aria-label="Período" value={preset} onChange={(e) => setPreset(e.target.value)} className={`${campo} !w-auto !py-1.5 !text-[12px]`}>{PRESETS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
          {preset === "custom" && <><input aria-label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} className={`${campo} !w-auto !py-1.5 !text-[12px]`} /><input aria-label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={`${campo} !w-auto !py-1.5 !text-[12px]`} /></>}
          <select aria-label="Funil" value={funilId} onChange={(e) => setFunilId(e.target.value)} className={`${campo} !w-auto !py-1.5 !text-[12px]`}><option value="">{aba === "funil" ? "Funil padrão" : "Todos os funis"}</option>{funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
        </div>
      </header>
      <div role="tablist" className="mx-6 flex gap-5 overflow-x-auto border-b border-linha">
        {ABAS.map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px whitespace-nowrap border-b-2 py-2 text-[13px] font-semibold ${aba === k ? "border-azul text-azul" : "border-transparent text-cinza"}`}>{r}</button>)}
      </div>
      <div className="flex-1 overflow-auto px-6 pb-8 pt-4">
        {preset === "custom" && (!de || !ate) ? <p className="py-10 text-center text-cinza">Escolha as duas datas.</p> : (
          <>
            {aba === "geral" && <Geral p={periodo} funilId={funilId} />}
            {aba === "funil" && <Funil p={periodo} funilId={funilEfetivo} />}
            {aba === "ganhos" && <Ganhos p={periodo} funilId={funilId} />}
            {aba === "equipe" && <Equipe p={periodo} funilId={funilId} />}
            {aba === "metas" && <Metas funis={funis} />}
            {aba === "auditoria" && <Auditoria p={periodo} funilId={funilId} />}
          </>
        )}
      </div>
    </div>
  );
}

function useRelatorio<T>(tipo: string, p: { de: string; ate: string }, funilId: string, extra = ""): { dados: T | null; erro: string | null } {
  const [estado, setEstado] = useState<{ dados: T | null; erro: string | null }>({ dados: null, erro: null });
  useEffect(() => {
    let vivo = true;
    setEstado({ dados: null, erro: null });
    if (tipo === "funil" && !funilId) return;
    fetch(`/api/relatorios/${tipo}?de=${p.de}&ate=${p.ate}${funilId ? `&funilId=${funilId}` : ""}${extra}`)
      .then(async (r) => (r.ok ? { dados: (await r.json()) as T, erro: null } : { dados: null, erro: ((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Erro ao carregar" }))
      .then((e) => { if (vivo) setEstado(e); }).catch(() => { if (vivo) setEstado({ dados: null, erro: "Erro ao carregar" }); });
    return () => { vivo = false; };
  }, [tipo, p.de, p.ate, funilId, extra]);
  return estado;
}
const Estado = ({ erro, vazio }: { erro: string | null; vazio?: boolean }) => <p className="py-10 text-center text-cinza" role={erro ? "alert" : undefined}>{erro ?? (vazio ? "Sem dados no período." : "Carregando…")}</p>;

function Geral({ p, funilId }: { p: { de: string; ate: string }; funilId: string }) {
  const { dados: k, erro } = useRelatorio<{ criadas: { quantidade: number; valor: number }; emAndamento: { quantidade: number; valor: number }; ganhas: { quantidade: number; valor: number; valorUnico: number; valorMensal: number }; perdidas: { quantidade: number; valor: number }; hitRate: number | null; ticketMedio: number | null; cicloMedioDias: number | null; previsao: { total: number; ponderada: number } }>("kpis", p, funilId);
  if (!k) return <Estado erro={erro} />;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      <Card rotulo="Oportunidades criadas" valor={String(k.criadas.quantidade)} nota={moeda(k.criadas.valor)} />
      <Card rotulo="Em andamento (agora)" valor={String(k.emAndamento.quantidade)} nota={moeda(k.emAndamento.valor)} />
      <Card rotulo="Ganhas" valor={String(k.ganhas.quantidade)} nota={`${moeda(k.ganhas.valorUnico)} único · ${moeda(k.ganhas.valorMensal)}/mês`} />
      <Card rotulo="Perdidas" valor={String(k.perdidas.quantidade)} nota={moeda(k.perdidas.valor)} />
      <Card rotulo="Valor ganho" valor={moeda(k.ganhas.valor)} />
      <Card rotulo="Taxa de conversão" valor={pct(k.hitRate)} nota="ganhas ÷ (ganhas + perdidas)" />
      <Card rotulo="Ticket médio" valor={k.ticketMedio === null ? "—" : moeda(k.ticketMedio)} />
      <Card rotulo="Ciclo médio de vendas" valor={dias(k.cicloMedioDias)} nota="da criação ao ganho" />
      <Card rotulo="Em aberto (valor)" valor={moeda(k.previsao.total)} />
      <Card rotulo="Previsão de fechamento" valor={moeda(k.previsao.ponderada)} nota="valor em aberto × chance por probabilidade (quente 80%, morna 50%, fria 20%, risco alto 5%, sem 30%)" />
    </div>
  );
}

function Funil({ p, funilId }: { p: { de: string; ate: string }; funilId: string }) {
  const { dados: d, erro } = useRelatorio<{ entradas: number; ganhas: number; conversaoTotal: number | null; etapas: Array<{ etapaId: string; nome: string; tipo: string; entraram: number; conversaoParaProxima: number | null; diasMedios: number | null; agora: number; valorAgora: number }> }>("funil", p, funilId);
  if (!d) return <Estado erro={erro} />;
  const max = Math.max(1, ...d.etapas.map((e) => e.entraram));
  return (
    <div className="max-w-4xl">
      <p className="mb-4 text-[13px] text-cinza">Oportunidades criadas no período: quantas chegaram a cada etapa ou foram além (quem pulou etapas também conta). Conversão total (entrada → ganha): <b className="text-grafite">{pct(d.conversaoTotal)}</b> ({d.ganhas} de {d.entradas}).</p>
      <ul className="space-y-1">
        {d.etapas.map((e) => (
          <li key={e.etapaId}>
            <div className="flex items-center gap-3 rounded-xl border border-linha bg-superficie px-4 py-3">
              <span className="w-44 flex-none truncate font-semibold">{e.nome}</span>
              <Barra valor={e.entraram} max={max} cor={e.tipo === "PERDIDA" ? "bg-cinza" : "bg-azul"} />
              <span className="w-10 flex-none text-right font-titulo text-[16px] font-extrabold">{e.entraram}</span>
              <span className="w-28 flex-none text-right text-[12px] text-cinza">{e.tipo === "ABERTA" ? `${dias(e.diasMedios)} na etapa` : ""}</span>
              <span className="w-32 flex-none text-right text-[12px] text-cinza">{e.tipo === "ABERTA" ? `${e.agora} agora · ${moeda(e.valorAgora)}` : ""}</span>
            </div>
            {e.conversaoParaProxima !== null && <p className="py-1 pl-6 text-[12px] font-semibold text-azul">↓ {pct(e.conversaoParaProxima)} chegaram à próxima etapa ou além</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ganhos({ p, funilId }: { p: { de: string; ate: string }; funilId: string }) {
  type Grupo = { total: number; semMotivo: number; linhas: Array<{ motivo: string; quantidade: number; valor: number }> };
  const { dados: d, erro } = useRelatorio<{ ganhas: Grupo; perdidas: Grupo }>("ganhos-perdas", p, funilId);
  if (!d) return <Estado erro={erro} />;
  const bloco = (titulo: string, g: Grupo, cor: string) => {
    const max = Math.max(1, ...g.linhas.map((l) => l.quantidade));
    return (
      <section className="rounded-xl border border-linha bg-superficie p-4" aria-label={titulo}>
        <h2 className="font-titulo text-[15px] font-extrabold">{titulo} <span className="font-texto text-[13px] font-normal text-cinza">({g.total})</span></h2>
        {g.total === 0 && <p className="py-6 text-center text-cinza">Nenhuma no período.</p>}
        <ul className="mt-3 space-y-2.5">
          {g.linhas.map((l) => (
            <li key={l.motivo}>
              <div className="flex items-center justify-between text-[13px]"><span className={l.motivo === "Sem motivo registrado" ? "text-cinza" : "font-semibold"}>{l.motivo}</span><span className="text-cinza">{l.quantidade} · {moeda(l.valor)}</span></div>
              <div className="mt-1 flex"><Barra valor={l.quantidade} max={max} cor={cor} /></div>
            </li>
          ))}
        </ul>
        {g.semMotivo > 0 && <p className="mt-3 text-[12px] text-cinza">{g.semMotivo} sem motivo: o relatório só fica útil se o motivo for registrado ao mover.</p>}
      </section>
    );
  };
  return <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">{bloco("Por que ganhamos", d.ganhas, "bg-azul")}{bloco("Por que perdemos", d.perdidas, "bg-cinza")}</div>;
}

function Equipe({ p, funilId }: { p: { de: string; ate: string }; funilId: string }) {
  const { dados: d, erro } = useRelatorio<{ linhas: Array<{ responsavelId: string | null; nome: string; criadas: number; ganhas: number; perdidas: number; valorGanho: number; hitRate: number | null }> }>("ranking", p, funilId);
  if (!d) return <Estado erro={erro} />;
  if (d.linhas.length === 0) return <Estado erro={null} vazio />;
  return (
    <div className="max-w-4xl overflow-auto rounded-xl border border-linha bg-superficie">
      <table className="w-full text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wide text-cinza"><tr>{["#", "Responsável", "Criadas", "Ganhas", "Perdidas", "Conversão", "Valor ganho"].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{d.linhas.map((l, i) => <tr key={l.responsavelId ?? "sem"} className="border-b border-linha last:border-0"><td className="px-4 py-2.5 text-cinza">{i + 1}</td><td className="px-4 py-2.5 font-semibold">{l.nome}</td><td className="px-4 py-2.5">{l.criadas}</td><td className="px-4 py-2.5">{l.ganhas}</td><td className="px-4 py-2.5">{l.perdidas}</td><td className="px-4 py-2.5">{pct(l.hitRate)}</td><td className="px-4 py-2.5 font-bold">{moeda(l.valorGanho)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function Metas({ funis }: { funis: Array<{ id: string; nome: string }> }) {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [tipo, setTipo] = useState("TOTAL");
  const [escopo, setEscopo] = useState("TODOS");
  const [meses, setMeses] = useState<Array<{ mes: number; meta: number | null; realizado: number; atingimento: number | null }> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/metas?ano=${ano}&tipo=${tipo}&escopo=${escopo}`);
    if (r.ok) setMeses((await r.json()).meses); else setErro("Erro ao carregar");
  }, [ano, tipo, escopo]);
  useEffect(() => { setMeses(null); void carregar(); }, [carregar]);
  const salvar = async (mes: number, texto: string) => {
    const valor = texto.trim() === "" ? 0 : Number(texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto);
    if (!Number.isFinite(valor) || valor < 0) { setErro("Valor inválido"); return; }
    setErro(null);
    await fetch("/api/metas", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ano, mes, tipo, escopo, valor }) });
    await carregar();
  };
  const sel = `${campo} !w-auto !py-1.5 !text-[12px]`;
  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <select aria-label="Ano" value={ano} onChange={(e) => setAno(Number(e.target.value))} className={sel}>{[ano - 1, ano, ano + 1].filter((v, i, a) => a.indexOf(v) === i).map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <select aria-label="Tipo de meta" value={tipo} onChange={(e) => setTipo(e.target.value)} className={sel}><option value="TOTAL">Total (único + mensal)</option><option value="UNICO">Valor único</option><option value="MENSAL">Valor mensal (MRR)</option></select>
        <select aria-label="Escopo" value={escopo} onChange={(e) => setEscopo(e.target.value)} className={sel}><option value="TODOS">Todos os funis</option>{funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
        <span className="text-cinza">Meta vazia ou zero = sem meta (não vira 100%).</span>
      </div>
      {erro && <p role="alert" className="mb-2 text-[13px] font-semibold text-critico">{erro}</p>}
      {!meses ? <Estado erro={null} /> : (
        <div className="overflow-auto rounded-xl border border-linha bg-superficie">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-cinza"><tr>{["Mês", "Meta (R$)", "Realizado", "Atingimento"].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{meses.map((m) => (
              <tr key={m.mes} className="border-b border-linha last:border-0">
                <td className="px-4 py-2 font-semibold">{MESES[m.mes - 1]}</td>
                <td className="px-4 py-2"><input aria-label={`Meta de ${MESES[m.mes - 1]}`} defaultValue={m.meta ?? ""} key={`${ano}-${tipo}-${escopo}-${m.mes}-${m.meta}`} inputMode="decimal" placeholder="sem meta" onBlur={(e) => { if ((e.target.value || "") !== String(m.meta ?? "")) void salvar(m.mes, e.target.value); }} className="w-32 rounded-lg border border-linha bg-superficie px-2 py-1" /></td>
                <td className="px-4 py-2">{moeda(m.realizado)}</td>
                <td className="px-4 py-2">{m.atingimento === null ? <span className="text-cinza">Sem meta</span> : <span className="flex items-center gap-2"><span className="w-12 font-bold">{pct(m.atingimento)}</span><Barra valor={Math.min(m.atingimento, 1)} max={1} /></span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ROTULO_ORIGEM: Record<string, string> = { CRIACAO: "Criada", MANUAL: "Manual", INTEGRACAO: "Vendedor IA", AUTOMACAO: "Automação", IMPORTACAO: "Reconstruída" };

function Auditoria({ p, funilId }: { p: { de: string; ate: string }; funilId: string }) {
  const [origem, setOrigem] = useState("");
  const { dados: d, erro } = useRelatorio<{ linhas: Array<{ id: string; quando: string; oportunidade: string; de: string | null; para: string; origem: string; ator: string; motivo: string | null }> }>("auditoria", p, funilId, origem ? `&origem=${origem}` : "");
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12px]"><span className="text-cinza">Movimentações de etapa: quem, quando, de onde para onde.</span>
        <select aria-label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value)} className={`${campo} ml-auto !w-auto !py-1.5 !text-[12px]`}><option value="">Todas as origens</option>{Object.entries(ROTULO_ORIGEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {!d ? <Estado erro={erro} /> : d.linhas.length === 0 ? <Estado erro={null} vazio /> : (
        <div className="overflow-auto rounded-xl border border-linha bg-superficie">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-cinza"><tr>{["Quando", "Oportunidade", "De", "Para", "Origem", "Quem", "Motivo"].map((h) => <th key={h} className="border-b border-linha px-3 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{d.linhas.map((l) => <tr key={l.id} className="border-b border-linha last:border-0"><td className="whitespace-nowrap px-3 py-2 text-cinza">{dataHora(l.quando)}</td><td className="px-3 py-2 font-semibold">{l.oportunidade}</td><td className="px-3 py-2 text-cinza">{l.de ?? "—"}</td><td className="px-3 py-2">{l.para}</td><td className="px-3 py-2">{ROTULO_ORIGEM[l.origem] ?? l.origem}</td><td className="px-3 py-2">{l.ator}</td><td className="px-3 py-2 text-cinza">{l.motivo ?? ""}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
