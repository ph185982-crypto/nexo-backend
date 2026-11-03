"use client";

import { useCallback, useEffect, useState } from "react";
import { botaoPrimario, botaoSecundario, Dialogo } from "@/components/dialogo";
import { acaoVazia, FormAutomacao, type AutomacaoForm, type FunilOpcao } from "@/components/form-automacao";
import { ROTULO_ACAO, ROTULO_CAMPO, ROTULO_GATILHO, type Acao, type Criterio, type Gatilho, type TipoAcao } from "@/lib/automacao/modelo";
import { dataHora } from "@/lib/formatar";

interface Item { id: string; nome: string; descricao: string | null; ativo: boolean; gatilho: Gatilho; criterios: Criterio[]; acoes: Acao[]; execucoes: { executadas: number; pendentes: number; ignoradas: number; erros: number } }
interface Exec { id: string; status: string; acaoTipo: TipoAcao; detalhe: string | null; oportunidade: string | null; executarEm: string; executadaEm: string | null }

const VAZIO: AutomacaoForm = { nome: "", descricao: "", ativo: true, gatilho: "OPORTUNIDADE_MOVIDA", criterios: [], acoes: [acaoVazia()] };

export default function AutomacoesPage() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [funis, setFunis] = useState<FunilOpcao[]>([]);
  const [form, setForm] = useState<{ id?: string; inicial: AutomacaoForm } | null>(null);
  const [verExec, setVerExec] = useState<Item | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/automacoes");
    if (r.ok) setItens((await r.json()).automacoes);
  }, []);
  useEffect(() => { void carregar(); fetch("/api/funis").then((r) => r.json()).then((j) => setFunis(j.funis ?? [])); }, [carregar]);

  const alternar = async (a: Item) => { await fetch(`/api/automacoes/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ativo: !a.ativo }) }); await carregar(); };
  const excluir = async (a: Item) => { if (window.confirm(`Excluir "${a.nome}" e o histórico dela?`)) { await fetch(`/api/automacoes/${a.id}`, { method: "DELETE" }); await carregar(); } };
  const varrer = async () => {
    const r = await fetch("/api/automacoes/varrer", { method: "POST" });
    if (r.ok) { const j = await r.json(); setAviso(`Varredura: ${j.varredura.avaliadas} oportunidade(s) avaliada(s), ${j.varredura.agendadas} ação(ões) agendada(s); ${j.execucao.executadas} executada(s), ${j.execucao.erros} com erro.`); await carregar(); }
  };
  const editar = (a: Item) => setForm({
    id: a.id,
    inicial: {
      nome: a.nome, descricao: a.descricao ?? "", ativo: a.ativo, gatilho: a.gatilho,
      criterios: a.criterios.map((c) => ({ campo: c.campo, operador: c.operador, valor: String(c.valor) })),
      acoes: a.acoes.map((x) => ({ ...acaoVazia(x.tipo), esperaHoras: String(x.esperaHoras ?? 0), ...("titulo" in x ? { titulo: x.titulo, prazoHoras: String(x.prazoHoras), prioridade: x.prioridade, tipoTarefa: x.tipoTarefa } : {}), ...("etapaId" in x ? { etapaId: x.etapaId } : {}), ...("tag" in x ? { tag: x.tag } : {}), ...("mensagem" in x ? { mensagem: x.mensagem } : {}), ...("url" in x ? { url: x.url } : {}) })),
    },
  });

  const resumo = (a: Item) => {
    const se = a.criterios.length ? ` se ${a.criterios.map((c) => ROTULO_CAMPO[c.campo].toLowerCase()).join(" e ")}` : "";
    return `${ROTULO_GATILHO[a.gatilho]}${se} → ${a.acoes.map((x) => ROTULO_ACAO[x.tipo].toLowerCase()).join(", ")}`;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3.5 px-6 py-3.5">
        <button onClick={() => setForm({ inicial: VAZIO })} aria-label="Nova automação" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-azul text-[20px] font-bold leading-none text-bq">+</button>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Automações</h1>
        <button onClick={varrer} className={`${botaoSecundario} ml-auto`} title="Procura oportunidades paradas ou sem interação e executa o que venceu">Executar agora</button>
      </header>
      {aviso && <p role="status" className="mx-6 mb-2 rounded-lg bg-azul-8 px-3 py-2 text-[13px] text-azul">{aviso}</p>}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {itens === null && <p className="py-10 text-center text-cinza">Carregando…</p>}
        {itens?.length === 0 && <p className="py-10 text-center text-cinza">Nenhuma automação ainda. Use o "+" e comece de um modelo.</p>}
        <ul className="space-y-3">
          {itens?.map((a) => (
            <li key={a.id} className="rounded-xl border border-linha bg-superficie p-4">
              <div className="flex items-start gap-3">
                <button role="switch" aria-checked={a.ativo} aria-label={`${a.ativo ? "Desativar" : "Ativar"} ${a.nome}`} onClick={() => alternar(a)} className={`mt-0.5 h-5 w-9 flex-none rounded-full p-0.5 ${a.ativo ? "bg-azul" : "bg-linha"}`}><i className={`block h-4 w-4 rounded-full bg-superficie transition-transform ${a.ativo ? "translate-x-4" : ""}`} /></button>
                <div className="min-w-0 flex-1">
                  <p className="font-titulo text-[15px] font-extrabold">{a.nome}</p>
                  <p className="text-[12px] text-cinza">{resumo(a)}</p>
                  <p className="mt-1.5 flex gap-3 text-[12px] text-cinza"><span>{a.execucoes.executadas} executada(s)</span>{a.execucoes.pendentes > 0 && <span>{a.execucoes.pendentes} aguardando</span>}{a.execucoes.erros > 0 && <span className="font-bold text-critico">{a.execucoes.erros} com erro</span>}</p>
                </div>
                <div className="flex flex-none gap-2 text-[12px] font-bold"><button className="text-azul" onClick={() => setVerExec(a)}>Execuções</button><button className="text-azul" onClick={() => editar(a)}>Editar</button><button className="text-critico" onClick={() => excluir(a)}>Excluir</button></div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {form && <FormAutomacao inicial={form.inicial} id={form.id} funis={funis} onFechar={() => setForm(null)} onSalvo={() => { setForm(null); void carregar(); }} />}
      {verExec && <Execucoes a={verExec} onFechar={() => setVerExec(null)} />}
    </div>
  );
}

function Execucoes({ a, onFechar }: { a: Item; onFechar: () => void }) {
  const [lista, setLista] = useState<Exec[] | null>(null);
  useEffect(() => { fetch(`/api/automacoes/${a.id}/execucoes`).then((r) => r.json()).then((j) => setLista(j.execucoes ?? [])); }, [a.id]);
  return (
    <Dialogo titulo={`Execuções — ${a.nome}`} onFechar={onFechar}>
      <ul className="max-h-[55vh] overflow-y-auto">
        {lista === null && <li className="py-3 text-[12px] text-cinza">Carregando…</li>}
        {lista?.length === 0 && <li className="py-3 text-[12px] text-cinza">Ainda não executou.</li>}
        {lista?.map((e) => (
          <li key={e.id} className="border-b border-linha py-2.5 text-[12.5px]">
            <p className="flex items-center justify-between gap-3"><span className="font-semibold">{e.oportunidade ?? "—"}</span>
              <span className={e.status === "ERRO" ? "font-bold text-critico" : e.status === "EXECUTADA" ? "font-bold text-ok" : "text-cinza"}>{{ EXECUTADA: "Executada", PENDENTE: "Aguardando", EXECUTANDO: "Executando", IGNORADA: "Ignorada", ERRO: "Erro" }[e.status] ?? e.status}</span></p>
            <p className="text-cinza">{ROTULO_ACAO[e.acaoTipo]} · {e.status === "PENDENTE" ? `vence ${dataHora(e.executarEm)}` : e.executadaEm ? dataHora(e.executadaEm) : ""}</p>
            {e.detalhe && <p className="text-cinza">{e.detalhe}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end"><button className={botaoPrimario} onClick={onFechar}>Fechar</button></div>
    </Dialogo>
  );
}
