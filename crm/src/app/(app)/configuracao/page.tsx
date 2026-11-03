"use client";

import { useCallback, useEffect, useState } from "react";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "@/components/dialogo";
import { dataHora } from "@/lib/formatar";

type Aba = "funis" | "motivos" | "usuarios" | "integracao" | "entrega";
const ABAS: Array<[Aba, string]> = [["funis", "Funis e etapas"], ["motivos", "Motivos"], ["usuarios", "Usuários"], ["integracao", "Integração"], ["entrega", "Modelo de entrega"]];

async function chamar(url: string, metodo: string, corpo?: unknown): Promise<{ ok: boolean; erro?: string; dados?: Record<string, unknown> }> {
  const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const dados = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return r.ok ? { ok: true, dados: dados ?? {} } : { ok: false, erro: (dados?.erro as string) ?? "Não foi possível concluir" };
}
const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";

export default function ConfiguracaoPage() {
  const [aba, setAba] = useState<Aba>("funis");
  return (
    <div className="flex h-full flex-col">
      <header className="px-6 py-3.5"><h1 className="text-[22px] font-extrabold leading-none tracking-tight">Configuração</h1></header>
      <div role="tablist" className="mx-6 flex gap-5 overflow-x-auto border-b border-linha">
        {ABAS.map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px whitespace-nowrap border-b-2 py-2 text-[13px] font-semibold ${aba === k ? "border-azul text-azul" : "border-transparent text-cinza"}`}>{r}</button>)}
      </div>
      <div className="flex-1 overflow-auto px-6 pb-8 pt-4">
        {aba === "funis" && <Funis />}{aba === "motivos" && <Motivos />}{aba === "usuarios" && <Usuarios />}{aba === "integracao" && <Integracao />}{aba === "entrega" && <Modelos />}
      </div>
    </div>
  );
}

function useLista<T>(url: string, chave: string) {
  const [dados, setDados] = useState<T[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(url);
    if (r.status === 403) { setErro("Somente administradores acessam esta área."); return; }
    if (r.ok) setDados(((await r.json()) as Record<string, T[]>)[chave]); else setErro("Não foi possível carregar.");
  }, [url, chave]);
  useEffect(() => { void carregar(); }, [carregar]);
  return { dados, erro, carregar };
}
const Aviso = ({ erro }: { erro: string | null }) => (erro ? <p role="alert" className="mb-3 text-[13px] font-semibold text-critico">{erro}</p> : null);

// ─── Funis e etapas ──────────────────────────────────────────────────────────
interface EtapaCfg { id: string; nome: string; tipo: string; ordem: number; descricao: string | null; oportunidades: number }
interface FunilCfg { id: string; nome: string; padrao: boolean; ativo: boolean; oportunidades: number; etapas: EtapaCfg[] }
const NATUREZA: Record<string, string> = { ABERTA: "Aberta", GANHA: "Ganha", PERDIDA: "Perdida" };

function Funis() {
  const { dados, erro, carregar } = useLista<FunilCfg>("/api/config/funis", "funis");
  const [msg, setMsg] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [etapa, setEtapa] = useState<{ funilId: string; etapa: EtapaCfg | null } | null>(null);
  const agir = async (url: string, metodo: string, corpo?: unknown, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return;
    const r = await chamar(url, metodo, corpo); setMsg(r.ok ? null : r.erro ?? null); await carregar();
  };
  const mover = (f: FunilCfg, i: number, d: -1 | 1) => { const ids = f.etapas.map((e) => e.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; void agir(`/api/config/funis/${f.id}/reordenar`, "POST", { etapaIds: ids }); };
  if (erro) return <Aviso erro={erro} />;
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between"><p className="text-[13px] text-cinza">A natureza da etapa (aberta, ganha, perdida) define o status, o motivo e a abertura da entrega.</p><button className={botaoPrimario} onClick={() => setNovo(true)}>Novo funil</button></div>
      <Aviso erro={msg} />
      {dados === null && <p className="py-8 text-center text-cinza">Carregando…</p>}
      {dados?.map((f) => (
        <section key={f.id} aria-label={f.nome} className="rounded-xl border border-linha bg-superficie p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-titulo text-[16px] font-extrabold">{f.nome}</h2>
            {f.padrao && <span className="rounded-full bg-azul-8 px-2.5 py-0.5 text-[11px] font-bold text-azul">Padrão</span>}
            {!f.ativo && <span className="rounded-full border border-linha px-2.5 py-0.5 text-[11px] font-bold text-cinza">Desativado</span>}
            <span className="text-[12px] text-cinza">{f.oportunidades} oportunidade(s)</span>
            <span className="ml-auto flex flex-wrap gap-3 text-[12px] font-bold">
              <button className="text-azul" onClick={() => { const n = window.prompt("Novo nome do funil", f.nome); if (n && n !== f.nome) void agir(`/api/config/funis/${f.id}`, "PATCH", { nome: n }); }}>Renomear</button>
              {!f.padrao && f.ativo && <button className="text-azul" onClick={() => agir(`/api/config/funis/${f.id}`, "PATCH", { padrao: true })}>Tornar padrão</button>}
              {!f.padrao && <button className="text-azul" onClick={() => agir(`/api/config/funis/${f.id}`, "PATCH", { ativo: !f.ativo })}>{f.ativo ? "Desativar" : "Ativar"}</button>}
              {!f.padrao && <button className="text-critico" onClick={() => agir(`/api/config/funis/${f.id}`, "DELETE", undefined, `Excluir o funil "${f.nome}"?`)}>Excluir</button>}
            </span>
          </div>
          <ol className="mt-3">
            {f.etapas.map((e, i) => (
              <li key={e.id} className="flex items-start gap-3 border-t border-linha py-2.5">
                <span className="flex flex-none flex-col"><button aria-label={`Subir ${e.nome}`} disabled={i === 0} onClick={() => mover(f, i, -1)} className="px-1 leading-none text-cinza disabled:opacity-30">▲</button><button aria-label={`Descer ${e.nome}`} disabled={i === f.etapas.length - 1} onClick={() => mover(f, i, 1)} className="px-1 leading-none text-cinza disabled:opacity-30">▼</button></span>
                <div className="min-w-0 flex-1"><p className="font-semibold">{e.nome} <span className="ml-1 text-[11px] font-bold text-cinza">{NATUREZA[e.tipo]}</span></p>{e.descricao && <p className="text-[12px] text-cinza">{e.descricao}</p>}<p className="text-[11.5px] text-cinza">{e.oportunidades} oportunidade(s)</p></div>
                <span className="flex flex-none gap-3 text-[12px] font-bold"><button className="text-azul" onClick={() => setEtapa({ funilId: f.id, etapa: e })}>Editar</button><button className="text-critico" onClick={() => agir(`/api/config/etapas/${e.id}`, "DELETE", undefined, `Excluir a etapa "${e.nome}"?`)}>Excluir</button></span>
              </li>
            ))}
          </ol>
          <button className="mt-1 text-[12px] font-bold text-azul" onClick={() => setEtapa({ funilId: f.id, etapa: null })}>+ etapa</button>
        </section>
      ))}
      {novo && <NovoFunil onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); void carregar(); }} />}
      {etapa && <FormEtapa funilId={etapa.funilId} etapa={etapa.etapa} onFechar={() => setEtapa(null)} onSalvo={() => { setEtapa(null); void carregar(); }} />}
    </div>
  );
}

function NovoFunil({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(""); const [padrao, setPadrao] = useState(false); const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Novo funil" onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await chamar("/api/config/funis", "POST", { nome, padrao }); if (r.ok) onSalvo(); else setErro(r.erro ?? null); }}>
        <label className="block"><span className={rotulo}>Nome</span><input required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} className="accent-[var(--azul)]" />Usar como funil padrão (recebe as oportunidades do Vendedor IA)</label>
        <p className="text-[12px] text-cinza">Nasce com Novo, Em andamento, Ganha e Perdida. Ajuste depois.</p>
        <Aviso erro={erro} />
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!nome.trim()}>Criar</button></div>
      </form>
    </Dialogo>
  );
}

function FormEtapa({ funilId, etapa, onFechar, onSalvo }: { funilId: string; etapa: EtapaCfg | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(etapa?.nome ?? ""); const [tipo, setTipo] = useState(etapa?.tipo ?? "ABERTA"); const [descricao, setDescricao] = useState(etapa?.descricao ?? ""); const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo={etapa ? "Editar etapa" : "Nova etapa"} onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const corpo = { nome, tipo, descricao: descricao || null }; const r = etapa ? await chamar(`/api/config/etapas/${etapa.id}`, "PATCH", corpo) : await chamar(`/api/config/funis/${funilId}/etapas`, "POST", corpo); if (r.ok) onSalvo(); else setErro(r.erro ?? null); }}>
        <label className="block"><span className={rotulo}>Nome</span><input required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
        <label className="block"><span className={rotulo}>Natureza</span><select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>{Object.entries(NATUREZA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block"><span className={rotulo}>Descrição (orientação ao vendedor)</span><textarea rows={3} maxLength={1000} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} placeholder="O que é esta etapa. AÇÃO: o que o vendedor faz aqui." /></label>
        <Aviso erro={erro} />
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!nome.trim()}>Salvar</button></div>
      </form>
    </Dialogo>
  );
}

// ─── Motivos ─────────────────────────────────────────────────────────────────
interface MotivoCfg { id: string; tipo: string; nome: string; ativo: boolean; usos: number }
function Motivos() {
  const { dados, erro, carregar } = useLista<MotivoCfg>("/api/config/motivos", "motivos");
  const [msg, setMsg] = useState<string | null>(null);
  const [nome, setNome] = useState<Record<string, string>>({ GANHO: "", PERDA: "" });
  const adicionar = async (tipo: string) => { const r = await chamar("/api/config/motivos", "POST", { tipo, nome: nome[tipo] }); setMsg(r.ok ? null : r.erro ?? null); if (r.ok) setNome({ ...nome, [tipo]: "" }); await carregar(); };
  const alternar = async (m: MotivoCfg) => { await chamar(`/api/config/motivos/${m.id}`, "PATCH", { ativo: !m.ativo }); await carregar(); };
  if (erro) return <Aviso erro={erro} />;
  return (
    <div className="max-w-4xl">
      <p className="mb-3 text-[13px] text-cinza">Motivo desativado some da lista de escolha, mas continua nos relatórios das oportunidades que já o usam.</p>
      <Aviso erro={msg} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {([["GANHO", "Motivos de ganho"], ["PERDA", "Motivos de perda"]] as const).map(([tipo, titulo]) => (
          <section key={tipo} aria-label={titulo} className="rounded-xl border border-linha bg-superficie p-4">
            <h2 className="font-titulo text-[15px] font-extrabold">{titulo}</h2>
            <ul className="mt-2">{dados?.filter((m) => m.tipo === tipo).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 border-t border-linha py-2 text-[13px]"><span className={m.ativo ? "" : "text-cinza line-through"}>{m.nome}</span><span className="flex items-center gap-3 text-[12px] text-cinza">{m.usos} uso(s)<button className="font-bold text-azul" onClick={() => alternar(m)}>{m.ativo ? "Desativar" : "Ativar"}</button></span></li>
            ))}</ul>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void adicionar(tipo); }}><input aria-label={`Novo motivo de ${tipo === "GANHO" ? "ganho" : "perda"}`} maxLength={80} value={nome[tipo]} onChange={(e) => setNome({ ...nome, [tipo]: e.target.value })} placeholder="Novo motivo" className={`${campo} !py-2`} /><button type="submit" className={botaoPrimario} disabled={!nome[tipo].trim()}>Adicionar</button></form>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Usuários ────────────────────────────────────────────────────────────────
interface UsuarioCfg { id: string; nome: string; email: string; papel: string; ativo: boolean; criadoEm: string }
function Usuarios() {
  const { dados, erro, carregar } = useLista<UsuarioCfg>("/api/config/usuarios", "usuarios");
  const [form, setForm] = useState<UsuarioCfg | "novo" | null>(null);
  if (erro) return <Aviso erro={erro} />;
  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex items-center justify-between"><p className="text-[13px] text-cinza">Administrador acessa configuração e exporta contatos. Vendedor trabalha no funil, tarefas e contatos.</p><button className={botaoPrimario} onClick={() => setForm("novo")}>Novo usuário</button></div>
      <div className="overflow-auto rounded-xl border border-linha bg-superficie">
        <table className="w-full text-left text-[13px]"><thead className="text-[11px] uppercase tracking-wide text-cinza"><tr>{["Nome", "E-mail", "Papel", "Situação", ""].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{dados?.map((u) => <tr key={u.id} className="border-b border-linha last:border-0"><td className="px-4 py-2.5 font-semibold">{u.nome}</td><td className="px-4 py-2.5 text-cinza">{u.email}</td><td className="px-4 py-2.5">{u.papel === "ADMIN" ? "Administrador" : "Vendedor"}</td><td className="px-4 py-2.5">{u.ativo ? "Ativo" : <span className="text-cinza">Desativado</span>}</td><td className="px-4 py-2.5 text-right"><button className="text-[12px] font-bold text-azul" onClick={() => setForm(u)}>Editar</button></td></tr>)}</tbody></table>
      </div>
      {form && <FormUsuario u={form === "novo" ? null : form} onFechar={() => setForm(null)} onSalvo={() => { setForm(null); void carregar(); }} />}
    </div>
  );
}

function FormUsuario({ u, onFechar, onSalvo }: { u: UsuarioCfg | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(u?.nome ?? ""); const [email, setEmail] = useState(u?.email ?? ""); const [papel, setPapel] = useState(u?.papel ?? "VENDEDOR"); const [ativo, setAtivo] = useState(u?.ativo ?? true); const [senha, setSenha] = useState(""); const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo={u ? "Editar usuário" : "Novo usuário"} onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = u ? await chamar(`/api/config/usuarios/${u.id}`, "PATCH", { nome, papel, ativo, ...(senha ? { senha } : {}) }) : await chamar("/api/config/usuarios", "POST", { nome, email, papel, senha }); if (r.ok) onSalvo(); else setErro(r.erro ?? null); }}>
        <label className="block"><span className={rotulo}>Nome</span><input required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
        {!u && <label className="block"><span className={rotulo}>E-mail</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} /></label>}
        <label className="block"><span className={rotulo}>Papel</span><select value={papel} onChange={(e) => setPapel(e.target.value)} className={campo}><option value="VENDEDOR">Vendedor</option><option value="ADMIN">Administrador</option></select></label>
        <label className="block"><span className={rotulo}>{u ? "Nova senha (deixe vazio para manter)" : "Senha (mínimo de 10 caracteres)"}</span><input type="password" autoComplete="new-password" required={!u} minLength={u ? 0 : 10} value={senha} onChange={(e) => setSenha(e.target.value)} className={campo} /></label>
        {u && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="accent-[var(--azul)]" />Usuário ativo</label>}
        <Aviso erro={erro} />
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={!nome.trim()}>Salvar</button></div>
      </form>
    </Dialogo>
  );
}

// ─── Integração (chaves do Vendedor IA) ──────────────────────────────────────
interface ChaveCfg { id: string; nome: string; prefixo: string; criadaEm: string; ultimoUsoEm: string | null; revogadaEm: string | null }
function Integracao() {
  const { dados, erro, carregar } = useLista<ChaveCfg>("/api/config/chaves", "chaves");
  const [nome, setNome] = useState(""); const [nova, setNova] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const criar = async (e: React.FormEvent) => { e.preventDefault(); const r = await chamar("/api/config/chaves", "POST", { nome }); if (r.ok) { setNova(r.dados!.chave as string); setNome(""); } else setMsg(r.erro ?? null); await carregar(); };
  const revogar = async (c: ChaveCfg) => { if (window.confirm(`Revogar "${c.nome}"? O sistema que usa esta chave para de enviar eventos na hora.`)) { await chamar(`/api/config/chaves/${c.id}`, "DELETE"); await carregar(); } };
  if (erro) return <Aviso erro={erro} />;
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-[13px] text-cinza">Chaves para sistemas que enviam eventos ao CRM (o Vendedor IA). Endereço: <code className="rounded bg-superficie px-1.5 py-0.5">/api/integracoes/vendedor-ia/eventos</code>. No Vendedor IA, guarde a chave como <code className="rounded bg-superficie px-1.5 py-0.5">CRM_API_KEY</code> e o endereço deste CRM como <code className="rounded bg-superficie px-1.5 py-0.5">CRM_URL</code>.</p>
      <Aviso erro={msg} />
      {nova && (
        <div role="status" className="rounded-xl border border-azul bg-azul-8 p-4">
          <p className="text-[13px] font-bold text-azul">Copie agora. Esta chave não será mostrada de novo.</p>
          <p className="mt-2 break-all rounded-lg bg-superficie p-3 font-mono text-[13px]">{nova}</p>
          <div className="mt-3 flex gap-2"><button className={botaoPrimario} onClick={() => void navigator.clipboard?.writeText(nova)}>Copiar</button><button className={botaoSecundario} onClick={() => setNova(null)}>Já guardei</button></div>
        </div>
      )}
      <form onSubmit={criar} className="flex gap-2"><input aria-label="Nome da chave" required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Vendedor IA)" className={`${campo} !py-2`} /><button type="submit" className={botaoPrimario} disabled={!nome.trim()}>Gerar chave</button></form>
      <div className="overflow-auto rounded-xl border border-linha bg-superficie">
        <table className="w-full text-left text-[13px]"><thead className="text-[11px] uppercase tracking-wide text-cinza"><tr>{["Nome", "Chave", "Criada", "Último uso", ""].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{dados?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-cinza">Nenhuma chave.</td></tr>}{dados?.map((c) => <tr key={c.id} className="border-b border-linha last:border-0"><td className="px-4 py-2.5 font-semibold">{c.nome}</td><td className="px-4 py-2.5 font-mono text-[12px] text-cinza">{c.prefixo}…</td><td className="px-4 py-2.5 text-cinza">{dataHora(c.criadaEm)}</td><td className="px-4 py-2.5 text-cinza">{c.ultimoUsoEm ? dataHora(c.ultimoUsoEm) : "nunca"}</td><td className="px-4 py-2.5 text-right">{c.revogadaEm ? <span className="text-[12px] text-cinza">Revogada</span> : <button className="text-[12px] font-bold text-critico" onClick={() => revogar(c)}>Revogar</button>}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

// ─── Modelo de entrega ───────────────────────────────────────────────────────
interface ModeloCfg { id: string; nome: string; descricao: string | null; padrao: boolean; ativo: boolean; itens: Array<{ id: string; titulo: string; pilar: string; prazoDias: number | null }> }
function Modelos() {
  const { dados, erro, carregar } = useLista<ModeloCfg>("/api/modelos-entrega", "modelos");
  const padrao = async (m: ModeloCfg) => { await chamar(`/api/config/modelos/${m.id}`, "PATCH", { padrao: true }); await carregar(); };
  if (erro) return <Aviso erro={erro} />;
  return (
    <div className="max-w-4xl space-y-3">
      <p className="text-[13px] text-cinza">O modelo padrão gera os cartões da entrega quando uma oportunidade é ganha. Os cartões podem ser editados em cada entrega.</p>
      {dados?.map((m) => (
        <section key={m.id} className="rounded-xl border border-linha bg-superficie p-4">
          <div className="flex items-center gap-2"><h2 className="font-titulo text-[15px] font-extrabold">{m.nome}</h2>{m.padrao && <span className="rounded-full bg-azul-8 px-2.5 py-0.5 text-[11px] font-bold text-azul">Padrão</span>}{!m.padrao && m.ativo && <button className="ml-auto text-[12px] font-bold text-azul" onClick={() => padrao(m)}>Tornar padrão</button>}</div>
          {m.descricao && <p className="text-[12px] text-cinza">{m.descricao}</p>}
          <ul className="mt-2 text-[13px]">{m.itens.map((i) => <li key={i.id} className="flex justify-between border-t border-linha py-1.5"><span>{i.titulo}</span><span className="text-[12px] text-cinza">{i.pilar.toLowerCase()}{i.prazoDias != null ? ` · ${i.prazoDias} dias` : ""}</span></li>)}</ul>
        </section>
      ))}
    </div>
  );
}
