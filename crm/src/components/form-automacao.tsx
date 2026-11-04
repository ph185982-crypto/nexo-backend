"use client";

import { useState } from "react";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";
import {
  CAMPOS_NUMERICOS, CAMPOS_SIM_NAO, GATILHOS, OPERADORES_DO_CAMPO, ROTULO_ACAO, ROTULO_CAMPO, ROTULO_GATILHO, TIPOS_ACAO, GATILHOS_DE_TEMPO,
  camposDoGatilho, criterioExigido, ehGatilhoDeEntrega,
  type Campo, type Gatilho, type TipoAcao,
} from "@/lib/automacao/modelo";
import { PILARES, ROTULO_PILAR } from "@/lib/entrega/constantes";
import { PRIORIDADES, TIPOS_TAREFA } from "@/lib/atividades/constantes";
import { ROTULO_PRIORIDADE, ROTULO_TIPO_TAREFA } from "@/lib/formatar-atividades";

export interface FunilOpcao { id: string; nome: string; etapas: Array<{ id: string; nome: string; tipo: string }> }
export interface CriterioForm { campo: Campo; operador: string; valor: string }
export interface AcaoForm { tipo: TipoAcao; titulo: string; prazoHoras: string; prioridade: string; tipoTarefa: string; etapaId: string; tag: string; mensagem: string; url: string; esperaHoras: string }
export interface AutomacaoForm { nome: string; descricao: string; ativo: boolean; gatilho: Gatilho; criterios: CriterioForm[]; acoes: AcaoForm[] }

export const acaoVazia = (tipo: TipoAcao = "CRIAR_TAREFA"): AcaoForm => ({ tipo, titulo: "", prazoHoras: "24", prioridade: "NORMAL", tipoTarefa: "TAREFA", etapaId: "", tag: "", mensagem: "", url: "", esperaHoras: "0" });

/** Modelos prontos: preenchem o formulário; nada é salvo até o usuário confirmar. */
export function modelos(funis: FunilOpcao[]): Array<{ rotulo: string; form: AutomacaoForm }> {
  const etapas = funis.flatMap((f) => f.etapas);
  const qualif = etapas.find((e) => e.tipo === "ABERTA" && /qualifica/i.test(e.nome));
  const base = { descricao: "", ativo: true };
  return [
    { rotulo: "Parada há 3 dias na qualificação → criar tarefa", form: { ...base, nome: "Qualificação parada", gatilho: "OPORTUNIDADE_ESTAGNADA", criterios: [{ campo: "diasNaEtapa", operador: ">=", valor: "3" }, ...(qualif ? [{ campo: "etapaId" as Campo, operador: "=", valor: qualif.id }] : [])], acoes: [{ ...acaoVazia(), titulo: "Destravar: retomar a conversa com o lead", prioridade: "ALTA", tipoTarefa: "WHATSAPP", prazoHoras: "4" }] } },
    { rotulo: "Sem interação há 7 dias → alerta na linha do tempo", form: { ...base, nome: "Cliente sumiu", gatilho: "OPORTUNIDADE_SEM_INTERACAO", criterios: [{ campo: "diasSemAtividade", operador: ">=", valor: "7" }], acoes: [{ ...acaoVazia("REGISTRAR_ALERTA"), mensagem: "Sete dias sem nenhuma atividade. Retome o contato ou encerre com motivo." }] } },
    { rotulo: "Ganhou → tarefa de primeiro pagamento", form: { ...base, nome: "Confirmar primeiro pagamento", gatilho: "OPORTUNIDADE_GANHA", criterios: [], acoes: [{ ...acaoVazia(), titulo: "Confirmar o primeiro pagamento e liberar o kickoff", prioridade: "ALTA", prazoHoras: "48" }] } },
    { rotulo: "Perdeu → reativar em 90 dias", form: { ...base, nome: "Reativar perdidas", gatilho: "OPORTUNIDADE_PERDIDA", criterios: [], acoes: [{ ...acaoVazia(), titulo: "Reativar: perguntar se o cenário mudou", tipoTarefa: "WHATSAPP", esperaHoras: "2160", prazoHoras: "72" }] } },
    { rotulo: "Entrega: cliente travou um cartão há 3 dias → cobrar", form: { ...base, nome: "Cobrar o cliente", gatilho: "ENTREGA_AGUARDANDO_CLIENTE", criterios: [{ campo: "diasAguardandoCliente", operador: ">=", valor: "3" }], acoes: [{ ...acaoVazia(), titulo: "Cobrar {cliente}: {cartao} (parado há {dias} dias)", tipoTarefa: "WHATSAPP", prioridade: "ALTA", prazoHoras: "24" }] } },
    { rotulo: "Entrega: cartão atrasado → alerta e tarefa", form: { ...base, nome: "Cartão atrasado", gatilho: "ENTREGA_CARTAO_ATRASADO", criterios: [], acoes: [{ ...acaoVazia("REGISTRAR_ALERTA"), mensagem: "Cartão atrasado: {cartao} ({dias} dias)." }, { ...acaoVazia(), titulo: "Destravar o cartão atrasado: {cartao}", prioridade: "ALTA", prazoHoras: "24" }] } },
    { rotulo: "Entrega: cliente em risco → tarefa urgente", form: { ...base, nome: "Cliente em risco", gatilho: "ENTREGA_EM_RISCO", criterios: [], acoes: [{ ...acaoVazia(), titulo: "{cliente} em risco: revisar a entrega e ligar para o dono", tipoTarefa: "LIGACAO", prioridade: "ALTA", prazoHoras: "24" }] } },
    { rotulo: "Entrega: renovação em 30 dias → ligar para o cliente", form: { ...base, nome: "Renovação em 30 dias", gatilho: "ENTREGA_RENOVACAO_PROXIMA", criterios: [{ campo: "diasParaRenovar", operador: "<=", valor: "30" }], acoes: [{ ...acaoVazia(), titulo: "Ligar para {cliente}: renovação em {dias} dias", tipoTarefa: "LIGACAO", prioridade: "ALTA", prazoHoras: "72" }] } },
    { rotulo: "Entrega concluída → pedir depoimento em 7 dias", form: { ...base, nome: "Depoimento do cliente", gatilho: "ENTREGA_CONCLUIDA", criterios: [], acoes: [{ ...acaoVazia(), titulo: "Pedir depoimento e indicação para {cliente}", tipoTarefa: "WHATSAPP", esperaHoras: "168", prazoHoras: "72" }] } },
  ];
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

export function formParaApi(f: AutomacaoForm) {
  return {
    nome: f.nome, descricao: f.descricao || null, ativo: f.ativo, gatilho: f.gatilho,
    criterios: f.criterios.map((c) => ({ campo: c.campo, operador: c.operador, valor: CAMPOS_SIM_NAO.includes(c.campo) ? c.valor === "true" : c.valor })),
    acoes: f.acoes.map((a) => {
      const espera = { esperaHoras: num(a.esperaHoras) };
      switch (a.tipo) {
        case "CRIAR_TAREFA": return { tipo: a.tipo, titulo: a.titulo, prazoHoras: num(a.prazoHoras), prioridade: a.prioridade, tipoTarefa: a.tipoTarefa, ...espera };
        case "MOVER_ETAPA": return { tipo: a.tipo, etapaId: a.etapaId, ...espera };
        case "ADICIONAR_TAG": return { tipo: a.tipo, tag: a.tag, ...espera };
        case "REGISTRAR_ALERTA": return { tipo: a.tipo, mensagem: a.mensagem, ...espera };
        case "DISPARAR_WEBHOOK": return { tipo: a.tipo, url: a.url, ...espera };
      }
    }),
  };
}

export function FormAutomacao({ inicial, id, funis, onFechar, onSalvo }: { inicial: AutomacaoForm; id?: string; funis: FunilOpcao[]; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<AutomacaoForm>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const etapas = funis.flatMap((fu) => fu.etapas.map((e) => ({ ...e, rotulo: funis.length > 1 ? `${fu.nome} · ${e.nome}` : e.nome })));
  const setCriterio = (i: number, p: Partial<CriterioForm>) => setF((x) => ({ ...x, criterios: x.criterios.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const setAcao = (i: number, p: Partial<AcaoForm>) => setF((x) => ({ ...x, acoes: x.acoes.map((a, j) => (j === i ? { ...a, ...p } : a)) }));
  const campos = camposDoGatilho(f.gatilho);
  const exigido = criterioExigido(f.gatilho);
  const deEntrega = ehGatilhoDeEntrega(f.gatilho);
  // Trocar de gatilho descarta critérios que não valem mais (ex.: "dias de atraso" fora dos gatilhos de cartão).
  const trocarGatilho = (g: Gatilho) => setF((x) => ({ ...x, gatilho: g, criterios: x.criterios.filter((c) => camposDoGatilho(g).includes(c.campo)) }));
  const novoCriterio = (): CriterioForm => {
    const campoNovo: Campo = exigido && !f.criterios.some((c) => c.campo === exigido.campo) ? exigido.campo : "origem";
    return { campo: campoNovo, operador: exigido?.campo === campoNovo ? exigido.operador : OPERADORES_DO_CAMPO[campoNovo][0], valor: "" };
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true); setErro(null);
    const r = await fetch(id ? `/api/automacoes/${id}` : "/api/automacoes", { method: id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formParaApi(f)) });
    setSalvando(false);
    if (r.ok) onSalvo(); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar");
  };

  const rotulo = "mb-1 block text-[12px] font-semibold text-cinza";
  const mini = `${campo} !py-2 !text-[13px]`;
  return (
    <Dialogo titulo={id ? "Editar automação" : "Nova automação"} onFechar={onFechar}>
      <form onSubmit={salvar} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {!id && (
          <label className="block"><span className={rotulo}>Começar de um modelo</span>
            <select className={mini} value="" onChange={(e) => { const m = modelos(funis)[Number(e.target.value)]; if (m) setF(m.form); }}>
              <option value="">Em branco</option>{modelos(funis).map((m, i) => <option key={i} value={i}>{m.rotulo}</option>)}
            </select></label>
        )}
        <label className="block"><span className={rotulo}>Nome</span><input required maxLength={120} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={mini} /></label>
        <label className="block"><span className={rotulo}>Quando</span>
          <select value={f.gatilho} onChange={(e) => trocarGatilho(e.target.value as Gatilho)} className={mini}>
            <optgroup label="Oportunidades">{GATILHOS.filter((g) => !ehGatilhoDeEntrega(g)).map((g) => <option key={g} value={g}>{ROTULO_GATILHO[g]}</option>)}</optgroup>
            <optgroup label="Funil de entrega">{GATILHOS.filter(ehGatilhoDeEntrega).map((g) => <option key={g} value={g}>{ROTULO_GATILHO[g]}</option>)}</optgroup>
          </select>
          {GATILHOS_DE_TEMPO.includes(f.gatilho) && <span className="mt-1 block text-[11.5px] text-cinza">Gatilho de tempo: roda na varredura diária ou em &quot;Executar agora&quot;.{exigido && ` Exige o critério "${ROTULO_CAMPO[exigido.campo]}" com "${exigido.operador === ">=" ? "≥" : "≤"}".`}</span>}
          {deEntrega && <span className="mt-1 block text-[11.5px] text-cinza">As ações valem para a oportunidade ganha que abriu a entrega; a tarefa vai para quem cuida do cartão. Nos textos, use {"{cliente}"}, {"{entrega}"}, {"{cartao}"} e {"{dias}"}.</span>}</label>

        <fieldset className="space-y-2"><legend className={rotulo}>Se (todos precisam valer)</legend>
          {f.criterios.map((c, i) => {
            const ops = OPERADORES_DO_CAMPO[c.campo];
            const lista = c.campo === "etapaId" ? etapas.map((e) => ({ v: e.id, r: e.rotulo })) : c.campo === "funilId" ? funis.map((fu) => ({ v: fu.id, r: fu.nome }))
              : c.campo === "probabilidade" ? [["RISCO_ALTO", "Risco alto"], ["FRIA", "Fria"], ["MORNA", "Morna"], ["QUENTE", "Quente"]].map(([v, r]) => ({ v, r }))
              : c.campo === "pilar" ? PILARES.map((p) => ({ v: p, r: ROTULO_PILAR[p] }))
              : CAMPOS_SIM_NAO.includes(c.campo) ? [{ v: "true", r: "Sim" }, { v: "false", r: "Não" }] : null;
            return (
              <div key={i} className="flex gap-2">
                <select aria-label="Campo" value={c.campo} onChange={(e) => { const campoNovo = e.target.value as Campo; setCriterio(i, { campo: campoNovo, operador: OPERADORES_DO_CAMPO[campoNovo][0], valor: CAMPOS_SIM_NAO.includes(campoNovo) ? "true" : "" }); }} className={mini}>{campos.map((k) => <option key={k} value={k}>{ROTULO_CAMPO[k]}</option>)}</select>
                <select aria-label="Operador" value={c.operador} onChange={(e) => setCriterio(i, { operador: e.target.value })} className={`${mini} !w-20 flex-none`}>{ops.map((o) => <option key={o} value={o}>{o === ">=" ? "≥" : o === "<=" ? "≤" : o === "!=" ? "≠" : "="}</option>)}</select>
                {lista ? <select aria-label="Valor" value={c.valor} onChange={(e) => setCriterio(i, { valor: e.target.value })} className={mini}><option value="">Escolha…</option>{lista.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}</select>
                  : <input aria-label="Valor" value={c.valor} inputMode={CAMPOS_NUMERICOS.includes(c.campo) ? "numeric" : "text"} onChange={(e) => setCriterio(i, { valor: e.target.value })} className={mini} />}
                <button type="button" aria-label="Remover critério" onClick={() => setF({ ...f, criterios: f.criterios.filter((_, j) => j !== i) })} className="flex-none px-1.5 text-[18px] text-cinza">×</button>
              </div>
            );
          })}
          <button type="button" className="text-[12px] font-bold text-azul" onClick={() => setF({ ...f, criterios: [...f.criterios, novoCriterio()] })}>+ critério</button>
        </fieldset>

        <fieldset className="space-y-3"><legend className={rotulo}>Então</legend>
          {f.acoes.map((a, i) => (
            <div key={i} className="space-y-2 rounded-[10px] border border-linha p-3">
              <div className="flex gap-2">
                <select aria-label="Ação" value={a.tipo} onChange={(e) => setAcao(i, { tipo: e.target.value as TipoAcao })} className={mini}>{TIPOS_ACAO.map((t) => <option key={t} value={t}>{ROTULO_ACAO[t]}</option>)}</select>
                <button type="button" aria-label="Remover ação" onClick={() => setF({ ...f, acoes: f.acoes.filter((_, j) => j !== i) })} className="flex-none px-1.5 text-[18px] text-cinza">×</button>
              </div>
              {a.tipo === "CRIAR_TAREFA" && (<>
                <input aria-label="Título da tarefa" placeholder="Título da tarefa" maxLength={200} value={a.titulo} onChange={(e) => setAcao(i, { titulo: e.target.value })} className={mini} />
                <div className="grid grid-cols-3 gap-2">
                  <select aria-label="Tipo da tarefa" value={a.tipoTarefa} onChange={(e) => setAcao(i, { tipoTarefa: e.target.value })} className={mini}>{TIPOS_TAREFA.map((t) => <option key={t} value={t}>{ROTULO_TIPO_TAREFA[t]}</option>)}</select>
                  <select aria-label="Prioridade" value={a.prioridade} onChange={(e) => setAcao(i, { prioridade: e.target.value })} className={mini}>{PRIORIDADES.map((p) => <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>)}</select>
                  <label className="flex items-center gap-1 text-[12px] text-cinza">prazo<input aria-label="Prazo em horas" inputMode="numeric" value={a.prazoHoras} onChange={(e) => setAcao(i, { prazoHoras: e.target.value })} className={`${mini} !px-2`} />h</label>
                </div></>)}
              {a.tipo === "MOVER_ETAPA" && <select aria-label="Etapa de destino" value={a.etapaId} onChange={(e) => setAcao(i, { etapaId: e.target.value })} className={mini}><option value="">Etapa de destino…</option>{etapas.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}</select>}
              {a.tipo === "ADICIONAR_TAG" && <input aria-label="Tag" placeholder="tag (sem espaços)" maxLength={40} value={a.tag} onChange={(e) => setAcao(i, { tag: e.target.value })} className={mini} />}
              {a.tipo === "REGISTRAR_ALERTA" && <textarea aria-label="Mensagem" rows={2} maxLength={500} placeholder="Mensagem que aparece na linha do tempo" value={a.mensagem} onChange={(e) => setAcao(i, { mensagem: e.target.value })} className={mini} />}
              {a.tipo === "DISPARAR_WEBHOOK" && <input aria-label="Endereço do webhook" placeholder="https://…" maxLength={500} value={a.url} onChange={(e) => setAcao(i, { url: e.target.value })} className={mini} />}
              <label className="flex items-center gap-2 text-[12px] text-cinza">Esperar <input aria-label="Espera em horas" inputMode="numeric" value={a.esperaHoras} onChange={(e) => setAcao(i, { esperaHoras: e.target.value })} className={`${mini} !w-20 !px-2`} /> horas antes de executar</label>
            </div>
          ))}
          <button type="button" className="text-[12px] font-bold text-azul" onClick={() => setF({ ...f, acoes: [...f.acoes, acaoVazia()] })}>+ ação</button>
        </fieldset>

        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} className="accent-[var(--azul)]" />Automação ativa</label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={salvando || !f.nome.trim() || f.acoes.length === 0}>{salvando ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </Dialogo>
  );
}
