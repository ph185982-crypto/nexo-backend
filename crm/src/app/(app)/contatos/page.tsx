"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "@/components/dialogo";
import { CICLOS, ROTULO_CICLO } from "@/lib/contatos/rotulos";

interface Item { id: string; tipo: string; nome: string; telefone: string | null; email: string | null; segmento: string | null; cicloDeVida: string; empresa: { nome: string } | null; _count: { oportunidades: number } }
interface Resposta { total: number; pagina: number; porPagina: number; itens: Item[] }
type Janela = "novo" | "importar" | "duplicados" | null;

export default function ContatosPage() {
  const [q, setQ] = useState(""); const [busca, setBusca] = useState(""); const [ciclo, setCiclo] = useState(""); const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [janela, setJanela] = useState<Janela>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setBusca(q); setPagina(1); }, 300); return () => clearTimeout(t); }, [q]);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/contatos?pagina=${pagina}&q=${encodeURIComponent(busca)}${ciclo ? `&ciclo=${ciclo}` : ""}`);
    if (r.ok) setDados(await r.json());
  }, [busca, pagina, ciclo]);
  useEffect(() => { void carregar(); }, [carregar]);

  const exportar = async () => {
    const r = await fetch("/api/contatos/exportar");
    if (r.status === 403) { setAviso("Somente administradores exportam contatos."); return; }
    if (!r.ok) { setAviso("Não foi possível exportar."); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    setAviso(null);
  };

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 py-3.5">
        <button onClick={() => setJanela("novo")} aria-label="Novo contato" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-azul text-[20px] font-bold leading-none text-bq">+</button>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Contatos</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px] font-bold text-azul">
          <button onClick={() => setJanela("importar")}>Importar</button><button onClick={exportar}>Exportar</button><button onClick={() => setJanela("duplicados")}>Duplicados</button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar contatos" className="w-full rounded-full border border-linha bg-superficie px-4 py-2 text-[13px] sm:w-80" />
        <select aria-label="Ciclo de vida" value={ciclo} onChange={(e) => { setCiclo(e.target.value); setPagina(1); }} className="rounded-full border border-linha bg-superficie px-3 py-2 text-[13px]"><option value="">Todos os ciclos</option>{CICLOS.map((c) => <option key={c} value={c}>{ROTULO_CICLO[c]}</option>)}</select>
        {aviso && <span role="alert" className="text-[13px] font-semibold text-critico">{aviso}</span>}
      </div>
      <div className="mx-6 flex-1 overflow-auto rounded-xl border border-linha bg-superficie">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="sticky top-0 bg-superficie text-[11px] uppercase tracking-wide text-cinza"><tr>{["Nome", "Telefone", "E-mail", "Segmento", "Ciclo de vida", "Oport."].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {dados?.itens.map((c) => (
              <tr key={c.id} className="border-b border-linha last:border-0 hover:bg-bq">
                <td className="px-4 py-2.5"><Link href={`/contatos/${c.id}`} className="font-semibold text-azul">{c.nome}</Link>{c.empresa && <span className="block text-[12px] text-cinza">{c.empresa.nome}</span>}</td>
                <td className="px-4 py-2.5 text-cinza">{c.telefone ?? "—"}</td><td className="px-4 py-2.5 text-cinza">{c.email ?? "—"}</td><td className="px-4 py-2.5 text-cinza">{c.segmento ?? "—"}</td>
                <td className="px-4 py-2.5">{ROTULO_CICLO[c.cicloDeVida] ?? c.cicloDeVida}</td><td className="px-4 py-2.5">{c._count.oportunidades}</td>
              </tr>
            ))}
            {dados && dados.itens.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-cinza">Nenhum contato encontrado.</td></tr>}
            {!dados && <tr><td colSpan={6} className="px-4 py-10 text-center text-cinza">Carregando…</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between px-6 py-3 text-[12px] text-cinza">
        <span>{dados ? `${dados.total} contato(s)` : ""}</span>
        <span className="flex items-center gap-3">
          <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-linha px-3 py-1 disabled:opacity-40">Anterior</button>{pagina} de {paginas}
          <button disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)} className="rounded-md border border-linha px-3 py-1 disabled:opacity-40">Próxima</button>
        </span>
      </footer>
      {janela === "novo" && <NovoContato onFechar={() => setJanela(null)} onCriado={() => { setJanela(null); void carregar(); }} />}
      {janela === "importar" && <Importar onFechar={() => setJanela(null)} onImportado={() => void carregar()} />}
      {janela === "duplicados" && <Duplicados onFechar={() => { setJanela(null); void carregar(); }} />}
    </div>
  );
}

const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";

function NovoContato({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [f, setF] = useState({ tipo: "PESSOA", nome: "", telefone: "", email: "", segmento: "", cargo: "" });
  const [erro, setErro] = useState<{ texto: string; existenteId?: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Dialogo titulo="Novo contato" onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setErro(null);
        const r = await fetch("/api/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
        if (r.ok) { onCriado(); return; }
        const j = (await r.json().catch(() => null)) as { erro?: string; existenteId?: string } | null;
        setErro({ texto: j?.erro ?? "Não foi possível criar", existenteId: j?.existenteId });
      }}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={rotulo}>Tipo</span><select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={campo}><option value="PESSOA">Pessoa</option><option value="EMPRESA">Empresa</option></select></label>
          <label className="block"><span className={rotulo}>Nome</span><input required maxLength={200} value={f.nome} onChange={(e) => set("nome", e.target.value)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Telefone</span><input inputMode="tel" value={f.telefone} onChange={(e) => set("telefone", e.target.value)} className={campo} placeholder="(62) 98446-5388" /></label>
          <label className="block"><span className={rotulo}>E-mail</span><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Segmento</span><input maxLength={100} value={f.segmento} onChange={(e) => set("segmento", e.target.value)} className={campo} /></label>
          <label className="block"><span className={rotulo}>Cargo</span><input maxLength={100} value={f.cargo} onChange={(e) => set("cargo", e.target.value)} className={campo} /></label>
        </div>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro.texto}{erro.existenteId && <> <Link href={`/contatos/${erro.existenteId}`} className="underline">Abrir o contato existente</Link></>}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!f.nome.trim()}>Criar</button></div>
      </form>
    </Dialogo>
  );
}

interface ResultadoImp { total: number; criados: number; duplicados: number; invalidos: number; camposIgnorados: number; simulacao: boolean; colunasReconhecidas: string[]; colunasIgnoradas: string[]; problemas: Array<{ linha: number; motivo: string }> }

function Importar({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [csv, setCsv] = useState(""); const [res, setRes] = useState<ResultadoImp | null>(null); const [erro, setErro] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const enviar = async (simular: boolean) => {
    setOcupado(true); setErro(null);
    const r = await fetch("/api/contatos/importar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, simular }) });
    setOcupado(false);
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErro(j?.erro ?? "Não foi possível importar"); return; }
    setRes(j); if (!simular) onImportado();
  };
  return (
    <Dialogo titulo="Importar contatos (CSV)" onFechar={onFechar}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <p className="text-[12.5px] text-cinza">Primeira linha com os nomes das colunas: <b>nome</b> (obrigatório), telefone, e-mail, empresa, segmento, cargo, cnpj, origem, tipo, ciclo de vida. Vírgula ou ponto e vírgula. Até 5.000 linhas. Quem já existe (mesmo telefone ou e-mail) é pulado.</p>
        <input type="file" accept=".csv,text/csv,text/plain" aria-label="Arquivo CSV" onChange={async (e) => { const a = e.target.files?.[0]; if (a) { setCsv(await a.text()); setRes(null); } }} className="block w-full text-[13px]" />
        <textarea rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setRes(null); }} placeholder={"nome;telefone;email\nAna Souza;(62) 98446-5388;ana@exemplo.com"} className={`${campo} font-mono !text-[12px]`} aria-label="Conteúdo do CSV" />
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        {res && (
          <div role="status" className="rounded-xl border border-linha p-3 text-[13px]">
            <p className="font-bold">{res.simulacao ? "Simulação (nada foi gravado)" : "Importação concluída"}</p>
            <p>{res.total} linha(s): <b>{res.criados}</b> {res.simulacao ? "seriam criadas" : "criadas"}, {res.duplicados} já existiam, {res.invalidos} inválida(s){res.camposIgnorados > 0 ? `, ${res.camposIgnorados} campo(s) ignorado(s)` : ""}.</p>
            {res.colunasIgnoradas.length > 0 && <p className="text-cinza">Colunas ignoradas: {res.colunasIgnoradas.join(", ")}</p>}
            {res.problemas.length > 0 && <ul className="mt-1 max-h-28 overflow-y-auto text-[12px] text-cinza">{res.problemas.map((p, i) => <li key={i}>Linha {p.linha}: {p.motivo}</li>)}</ul>}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={botaoSecundario} onClick={onFechar}>Fechar</button>
          <button type="button" className={botaoSecundario} disabled={!csv.trim() || ocupado} onClick={() => enviar(true)}>Simular</button>
          <button type="button" className={botaoPrimario} disabled={!csv.trim() || ocupado || !res?.simulacao || res.criados === 0} onClick={() => enviar(false)} title="Simule antes para ver o que vai acontecer">Importar {res?.simulacao ? res.criados : ""}</button>
        </div>
      </div>
    </Dialogo>
  );
}

interface Grupo { motivo: string; valor: string; contatos: Array<{ id: string; tipo: string; nome: string; telefone: string | null; email: string | null; cicloDeVida: string; oportunidades: number }> }

function Duplicados({ onFechar }: { onFechar: () => void }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => { const r = await fetch("/api/contatos/duplicados"); if (r.ok) setGrupos((await r.json()).grupos); }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  const mesclar = async (origem: string, destino: string, nome: string) => {
    if (!window.confirm(`Juntar este contato em "${nome}"? Oportunidades, tarefas e histórico passam para ele. Não dá para desfazer.`)) return;
    const r = await fetch("/api/contatos/mesclar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origemId: origem, destinoId: destino }) });
    if (!r.ok) setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível mesclar"); else setErro(null);
    await carregar();
  };
  const por: Record<string, string> = { telefone: "mesmo telefone", email: "mesmo e-mail", nome: "mesmo nome" };
  return (
    <Dialogo titulo="Contatos duplicados" onFechar={onFechar}>
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        {grupos === null && <p className="text-cinza">Procurando…</p>}
        {grupos?.length === 0 && <p className="py-6 text-center text-cinza">Nenhum duplicado encontrado.</p>}
        {grupos?.map((g, i) => (
          <section key={i} className="rounded-xl border border-linha p-3" aria-label={`Duplicados por ${g.motivo}`}>
            <p className="mb-1 text-[12px] font-bold text-cinza">{por[g.motivo]}: {g.valor}</p>
            <ul>{g.contatos.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-t border-linha py-2 text-[13px]">
                <span className="min-w-0"><Link href={`/contatos/${c.id}`} className="font-semibold text-azul">{c.nome}</Link> <span className="text-cinza">{c.tipo === "EMPRESA" ? "empresa" : "pessoa"} · {c.oportunidades} oport.</span></span>
                <span className="flex flex-none flex-wrap justify-end gap-1">{g.contatos.filter((o) => o.id !== c.id && o.tipo === c.tipo).map((o) => <button key={o.id} onClick={() => mesclar(o.id, c.id, c.nome)} className="text-[12px] font-bold text-azul" title={`Juntar ${o.nome} neste`}>Juntar {o.nome.split(" ")[0]} aqui</button>)}</span>
              </li>))}</ul>
          </section>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><button className={botaoPrimario} onClick={onFechar}>Fechar</button></div>
    </Dialogo>
  );
}
