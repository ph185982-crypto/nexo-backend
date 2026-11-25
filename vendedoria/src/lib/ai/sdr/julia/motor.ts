// Motor do roteiro da Júlia — funções PURAS (sem banco, sem rede): o agente (../agent.ts) faz a entrada/saída e
// aplica os efeitos. O modelo só ajuda a ler o que o lead disse e a escrever a reação/resposta de FAQ; quem decide
// rota, pergunta, horário, passagem e encerramento é o código.
import type { Slot } from "@/lib/agenda/slots";
import type { SDRSession, SDRLLMResponse } from "../types";
import { pareceNomeDePessoa } from "../handoff-gate";
import {
  ABERTURAS, PERGUNTA_CNPJ, PERGUNTA_FATURAMENTO, PERGUNTA_LOJA, PROIBIDO_SEMPRE, FATURAMENTO_FUTURO,
  TEXTO_FOLLOWUP_2, TEXTO_RECEBI_FOTO, TEXTO_RESPOSTA_AUTOMATICA,
  sem, textoFollowup1, textoFollowup1Qualificado, textosConfirmacao, textosFora, textosMorno, textosNovosHorarios, textosQualificado,
  tipoDeAbertura, type Abertura,
} from "./roteiro";
import { proibidoDaPersona, type Persona } from "./persona";
import { classificar, cnpjAtivo, lerFaixa, lojaOuEstoque, proximaPergunta, simOuNao, type Icp, type Pergunta } from "./icp";
import { ehMidia, ehRespostaAutomatica, escolherSlot, pediuTrocarHorario } from "./sinais";

export type AcaoTurno =
  | "abertura" | "perguntar" | "oferecer_horarios" | "marcar_ligacao" | "morno" | "fora"
  | "silencio" | "auto_resposta_pausa" | "auto_resposta_parar";

export interface SaidaTurno {
  acao: AcaoTurno;
  mensagens: string[];
  sessao: SDRSession;
  icp: Icp;
  /** ISO do horário escolhido (acao = marcar_ligacao). */
  slotEscolhido?: string;
}

export const PERGUNTA_TEXTO: Record<Pergunta, string> = { loja: PERGUNTA_LOJA, cnpj: PERGUNTA_CNPJ, faturamento: PERGUNTA_FATURAMENTO };

export function primeiroNome(s: Pick<SDRSession, "nome">, perfil?: string | null): string | null {
  const n = pareceNomeDePessoa(s.nome) ? s.nome : pareceNomeDePessoa(perfil) ? String(perfil) : "";
  const p = n.trim().split(/\s+/)[0];
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : null;
}

/** Qual pergunta do roteiro este texto faz (para ler a resposta curta no próximo turno). */
export function perguntaDoTexto(t: string): Pergunta | "horario" | null {
  const x = sem(t);
  if (!x.includes("?") && !/1\) ate 20 mil/.test(x)) return null;
  if (/cnpj/.test(x)) return "cnpj";
  if (/fatura/.test(x)) return "faturamento";
  if (/loja fisica|estoque proprio|fabrica|atacado|algum dos dois/.test(x)) return "loja";
  if (/te ligar|horario|qual fica melhor/.test(x)) return "horario";
  return null;
}

const LOJA_SIM = /(tenho|temos|tem|possuo|minha|nossa)\s+(uma\s+)?(loja|fabrica|confeccao|atacado|distribuidora|estoque|ponto)|loja fisica|loja de rua|fabrica propria|estoque proprio|sou (fabricante|atacadista)|produzo|fabrico|confecciono/;
const LOJA_NAO = /(nao tenho|nao temos|sem) (loja|estoque|fabrica)|so (online|pela internet|no instagram|no insta)|vendo so online|afiliad|dropship|revendo sem estoque|ainda e (uma )?ideia|so a ideia|ainda nao (tenho|comecei)|nenhum dos dois|nao tenho nenhum/;

/** Lê loja/estoque da mensagem: explícito sempre; "sim"/"não" curto só se a pergunta foi essa. */
export function lerLojaEstoque(mensagem: string, perguntaAnterior?: string | null): { valor: boolean; tipo?: string } | null {
  const t = sem(mensagem);
  if (LOJA_NAO.test(t)) return { valor: false };
  if (LOJA_SIM.test(t)) {
    const tipo = /fabrica|fabrico|produzo|confecc/.test(t) ? "fábrica" : /atacad|distribuidora/.test(t) ? "atacado" : /estoque/.test(t) ? "estoque próprio" : "loja física";
    return { valor: true, tipo };
  }
  if (perguntaAnterior === "loja") {
    // resposta ao 1º follow-up: 1) tenho loja ou estoque 2) vendo só online 3) estou começando
    const num = lerRespostaFollowup(mensagem);
    if (num !== null && t.trim().length <= 3) return { valor: num, ...(num ? { tipo: "loja ou estoque" } : {}) };
    const sn = simOuNao(mensagem);
    if (sn !== null) return { valor: sn, ...(sn ? { tipo: "loja ou estoque" } : {}) };
  }
  return null;
}

export function lerCnpj(mensagem: string, perguntaAnterior?: string | null): boolean | null {
  const t = sem(mensagem);
  if (/(nao tenho|nao temos|sem|ainda nao tenho|nao possuo) cnpj|cnpj (ainda )?nao|vou abrir (o )?cnpj/.test(t)) return false;
  if (/(tenho|temos|tem|possuo) cnpj|cnpj (ativo|sim)|\bmei\b|\bltda\b|\beireli\b/.test(t) || mensagem.replace(/\D/g, "").length === 14) return true;
  if (perguntaAnterior === "cnpj") return simOuNao(mensagem);
  return null;
}

/** Abertura (1ª mensagem do lead): texto fixo pela opção do anúncio. */
export function turnoAbertura(sessao: SDRSession, mensagem: string): SaidaTurno {
  const abertura: Abertura = tipoDeAbertura(mensagem);
  const s: SDRSession = { ...sessao, abertura, etapa: "descoberta", status: "em_qualificacao" };
  if (abertura === "tenho_loja") { s.loja_fisica = "sim"; s.tem_loja_fisica = true; s.tipo_estoque ||= "loja física"; }
  s.ultima_pergunta = abertura === "comecando" || abertura === "outra" ? "loja" : undefined;
  return { acao: "abertura", mensagens: [...ABERTURAS[abertura]], sessao: s, icp: classificar(s) };
}

/** Valor em dinheiro que não seja o case permitido (Lumière: "R$ 1 milhão de faturamento"). Preço nunca sai. */
export function citaPreco(t: string): boolean {
  const semCase = t.replace(/R\$\s?1 milh[aã]o de faturamento/gi, "");
  return /R\$\s?\d|\d[\d.,]*\s?(reais|mil reais)\b|\bpor m[eê]s\b.*\d|\bmensalidade\b.*\d/i.test(semCase);
}

/** Mensagens do modelo que podem sair: sem Nexo/600, sem pergunta de faturamento futuro, no máximo 3. */
export function limparMensagensDoModelo(msgs: Array<{ text: string }> | undefined, persona: Persona = "julia"): string[] {
  const nome = proibidoDaPersona(persona);
  return (msgs ?? [])
    .map((m) => String(m?.text ?? "").replace(/\*\*/g, "").trim())
    .filter((t) => t && !PROIBIDO_SEMPRE.test(t) && !nome.test(t) && !FATURAMENTO_FUTURO.test(t) && !citaPreco(t))
    .slice(0, 3);
}

const PERGUNTOU = /\?|^(quanto|como|qual|quais|quem|onde|quando|por ?que|voces|vc|você|e se|tem como|da pra|dá pra)\b/i;
export function leadFezPergunta(mensagem: string): boolean {
  return PERGUNTOU.test(mensagem.trim());
}

/**
 * Turno normal (depois da abertura, antes da passagem). Aplica primeiro o que o código lê da mensagem, depois o que
 * o modelo leu, decide a rota e monta as mensagens. `llm` pode ser null (modelo fora do ar): o roteiro segue com os
 * textos fixos.
 */
export function turnoJulia(e: {
  sessao: SDRSession;
  mensagem: string;
  llm: SDRLLMResponse | null;
  slotsLivres: Slot[];
  agora?: Date;
  nomePerfil?: string | null;
  persona?: Persona;
}): SaidaTurno {
  const agora = e.agora ?? new Date();
  const s: SDRSession = { ...e.sessao };
  const perguntaAnterior = s.ultima_pergunta ?? null;
  const up = (e.llm?.updateSession ?? {}) as Partial<SDRSession> & { horario_escolhido?: string; faixa_faturamento?: number };

  // 1) O que o modelo leu (campos descritivos) — só preenche o que ainda está vazio, menos loja/CNPJ/faixa (abaixo).
  if (up.nome && !pareceNomeDePessoa(s.nome) && pareceNomeDePessoa(up.nome)) s.nome = up.nome.trim();
  for (const k of ["empresa", "segmento", "frase_chave", "tipo_estoque"] as const) {
    const v = up[k];
    if (typeof v === "string" && v.trim()) (s[k] as string) = v.trim().slice(0, 200);
  }
  if (Array.isArray(up.marketplace_atual) && up.marketplace_atual.length) s.marketplace_atual = Array.from(new Set([...(s.marketplace_atual ?? []), ...up.marketplace_atual.filter((x) => typeof x === "string")]));
  if (Array.isArray(up.objecoes_mencionadas) && up.objecoes_mencionadas.length) s.objecoes_mencionadas = Array.from(new Set([...(s.objecoes_mencionadas ?? []), ...up.objecoes_mencionadas.filter((x) => typeof x === "string")]));

  // 2) Loja/estoque e CNPJ: o código lê primeiro; o modelo só completa quando o código não soube.
  const loja = lerLojaEstoque(e.mensagem, perguntaAnterior);
  if (loja) { s.loja_fisica = loja.valor ? "sim" : "nao"; s.tem_loja_fisica = loja.valor; if (loja.tipo && !s.tipo_estoque) s.tipo_estoque = loja.tipo; }
  else if (lojaOuEstoque(s) === null && (up.loja_fisica === "sim" || up.loja_fisica === "nao")) { s.loja_fisica = up.loja_fisica; s.tem_loja_fisica = up.loja_fisica === "sim"; }
  const cnpj = lerCnpj(e.mensagem, perguntaAnterior);
  if (cnpj !== null) s.cnpj = cnpj ? "tem" : "nao tem";
  else if (cnpjAtivo(s) === null && typeof up.cnpj === "string" && up.cnpj.trim()) s.cnpj = up.cnpj.trim();

  // 3) Faturamento ATUAL: só como resposta à pergunta (nunca meta/esperado).
  // (só quando a ÚLTIMA pergunta foi a de faturamento: "às 18h30" na escolha do horário não é faturamento)
  if (perguntaAnterior === "faturamento") {
    const f = lerFaixa(e.mensagem);
    if (f !== null) { s.faixa_faturamento = f; s.faturamento_total = e.mensagem.trim().slice(0, 120); }
    else if (typeof up.faixa_faturamento === "number" && up.faixa_faturamento >= 0 && up.faixa_faturamento <= 4) {
      s.faixa_faturamento = up.faixa_faturamento as SDRSession["faixa_faturamento"];
      s.faturamento_total = e.mensagem.trim().slice(0, 120);
    } else {
      s.faixa_faturamento = 0; // respondeu outra coisa: segue sem insistir
    }
  }

  const icp = classificar(s);
  s.icp = icp;
  const nome = primeiroNome(s, e.nomePerfil);
  const doModelo = limparMensagensDoModelo(e.llm?.messages, e.persona);
  const reacao = doModelo.filter((t) => !t.includes("?")).slice(0, 1);
  const respostaAPergunta = leadFezPergunta(e.mensagem) ? doModelo.slice(0, 2) : [];

  if (icp === "FORA") return { acao: "fora", mensagens: textosFora(nome), sessao: { ...s, status: "fora", etapa: "encerrado_fora", ultima_pergunta: undefined }, icp };
  if (icp === "MORNO") return { acao: "morno", mensagens: textosMorno(nome), sessao: { ...s, status: "morno", etapa: "encerrado_morno", ultima_pergunta: undefined }, icp };

  if (icp === "QUALIFICADO") {
    const oferecidos = s.slots_oferecidos ?? [];
    let escolhido = escolherSlot(e.mensagem, oferecidos, agora);
    if (!escolhido && up.horario_escolhido && oferecidos.includes(up.horario_escolhido)) escolhido = up.horario_escolhido;
    if (escolhido && perguntaAnterior === "horario") {
      return { acao: "marcar_ligacao", mensagens: [], sessao: { ...s, horario_reuniao: escolhido, ultima_pergunta: undefined }, icp, slotEscolhido: escolhido };
    }
    if (proximaPergunta(s) === "faturamento") {
      return { acao: "perguntar", mensagens: [...(respostaAPergunta.length ? respostaAPergunta : reacao), PERGUNTA_FATURAMENTO].slice(-3), sessao: { ...s, faturamento_perguntado: true, ultima_pergunta: "faturamento", status: "em_qualificacao" }, icp };
    }
    const [a, b] = e.slotsLivres;
    if (!a) {
      // agenda sem horário livre nos próximos 14 dias: o Pedro combina direto
      return { acao: "marcar_ligacao", mensagens: [], sessao: { ...s, ultima_pergunta: undefined }, icp };
    }
    const msgs = perguntaAnterior === "horario"
      ? [...respostaAPergunta, ...textosNovosHorarios(a.label, b?.label ?? null)]
      : [...respostaAPergunta, ...textosQualificado(nome, a.label, b?.label ?? null)];
    return {
      acao: "oferecer_horarios", mensagens: msgs.slice(-3),
      sessao: { ...s, slots_oferecidos: [a.iso, ...(b ? [b.iso] : [])], ultima_pergunta: "horario", status: "qualificado", qualificado_em: s.qualificado_em ?? agora.toISOString() },
      icp,
    };
  }

  // PENDENTE: o modelo reage/responde; a próxima pergunta é a do roteiro (nunca uma já respondida).
  const proxima = proximaPergunta(s) ?? "loja";
  const respondida = (t: string) => {
    const q = perguntaDoTexto(t);
    return (q === "loja" && lojaOuEstoque(s) !== null) || (q === "cnpj" && cnpjAtivo(s) !== null) || (q === "faturamento" && s.faturamento_perguntado);
  };
  let msgs = doModelo.filter((t) => !respondida(t));
  const temPergunta = msgs.some((t) => perguntaDoTexto(t) === proxima);
  if (!temPergunta) {
    // tira perguntas fora do roteiro e põe a do roteiro no fim
    msgs = msgs.filter((t) => !t.includes("?") || leadFezPergunta(e.mensagem)).slice(0, 2);
    msgs.push(PERGUNTA_TEXTO[proxima]);
  }
  return { acao: "perguntar", mensagens: msgs.slice(-3), sessao: { ...s, ultima_pergunta: proxima, status: "em_qualificacao", etapa: "qualificacao" }, icp };
}

/** Pré-turno: resposta automática (não responde e pausa; na 2ª depois da retomada, para). null = segue normal. */
export function turnoRespostaAutomatica(sessao: SDRSession, mensagem: string, anteriorDoLead: string | null, agora: Date = new Date()): SaidaTurno | null {
  if (!ehRespostaAutomatica(mensagem, anteriorDoLead)) return null;
  const icp = classificar(sessao);
  if (sessao.auto_resposta?.retomada_em) return { acao: "auto_resposta_parar", mensagens: [], sessao: { ...sessao, status: "fora", etapa: "perdido_resposta_automatica" }, icp };
  if (sessao.auto_resposta) return { acao: "silencio", mensagens: [], sessao, icp };
  return { acao: "auto_resposta_pausa", mensagens: [], sessao: { ...sessao, auto_resposta: { detectada_em: agora.toISOString() } }, icp };
}

export type AcaoPosPassagem = "silencio" | "recebi_foto" | "oferecer_novos_horarios" | "remarcar";

/** Depois da passagem a Júlia fica em silêncio, com 2 exceções: foto (uma vez) e troca de horário. */
export function turnoPosPassagem(e: { sessao: SDRSession; mensagem: string; slotsLivres: Slot[]; agora?: Date }): { acao: AcaoPosPassagem; mensagens: string[]; sessao: SDRSession; slotEscolhido?: string } {
  const s = { ...e.sessao };
  if (s.etapa === "remarcando") {
    const escolhido = escolherSlot(e.mensagem, s.slots_oferecidos ?? [], e.agora);
    if (escolhido) return { acao: "remarcar", mensagens: [], sessao: { ...s, horario_reuniao: escolhido, etapa: "ligacao_marcada" }, slotEscolhido: escolhido };
  }
  if (pediuTrocarHorario(e.mensagem)) {
    const atual = s.horario_reuniao;
    const livres = e.slotsLivres.filter((x) => x.iso !== atual).slice(0, 2);
    if (livres.length) {
      return { acao: "oferecer_novos_horarios", mensagens: textosNovosHorarios(livres[0].label, livres[1]?.label ?? null), sessao: { ...s, etapa: "remarcando", slots_oferecidos: livres.map((x) => x.iso) } };
    }
  }
  if (ehMidia(e.mensagem) && !s.foto_respondida) return { acao: "recebi_foto", mensagens: [TEXTO_RECEBI_FOTO], sessao: { ...s, foto_respondida: true } };
  return { acao: "silencio", mensagens: [], sessao: s };
}

export interface PlanoFollowup {
  /** pular = não manda nada e encerra a sequência. */
  acao: "pular" | "enviar";
  texto?: string;
  /** Depois de mandar, move para Perdido com este motivo. */
  perdido?: string;
  /** Encerra a sequência depois deste envio. */
  encerrar: boolean;
  sessao: SDRSession;
}

export const MOTIVO_SEM_RESPOSTA = "Sem resposta";
export const MOTIVO_RESPOSTA_AUTOMATICA = "Resposta automática";

/** Follow-up do roteiro: 1º (dia seguinte) e 2º (3º dia, encerra e vai para Perdido). Nunca para Fora/Morno/passado. */
export function planoFollowup(sessao: SDRSession, step: number, slotsLivres: Slot[], nomePerfil?: string | null): PlanoFollowup {
  const s = { ...sessao };
  if (s.auto_resposta && !s.auto_resposta.retomada_em) {
    return { acao: "enviar", texto: TEXTO_RESPOSTA_AUTOMATICA, encerrar: true, sessao: { ...s, auto_resposta: { ...s.auto_resposta, retomada_em: new Date().toISOString() } } };
  }
  const icp = classificar(s);
  if (s.auto_resposta || icp === "FORA" || icp === "MORNO" || ["fora", "morno", "handoff_enviado"].includes(s.status)) return { acao: "pular", encerrar: true, sessao: s };
  const nome = primeiroNome(s, nomePerfil);
  if (step <= 1) {
    if (icp === "QUALIFICADO" && slotsLivres[0]) {
      return { acao: "enviar", texto: textoFollowup1Qualificado(nome, slotsLivres[0].label, slotsLivres[1]?.label ?? null), encerrar: false, sessao: { ...s, slots_oferecidos: slotsLivres.slice(0, 2).map((x) => x.iso), ultima_pergunta: "horario" } };
    }
    return { acao: "enviar", texto: textoFollowup1(nome), encerrar: false, sessao: { ...s, ultima_pergunta: "loja" } };
  }
  return { acao: "enviar", texto: TEXTO_FOLLOWUP_2, encerrar: true, perdido: MOTIVO_SEM_RESPOSTA, sessao: { ...s, status: "inativo" } };
}

/** Resposta ao 1º follow-up ("1", "2", "3"): 1 = tem loja/estoque; 2 = só online (fora); 3 = começando (fora). */
export function lerRespostaFollowup(mensagem: string): boolean | null {
  const t = sem(mensagem).trim();
  if (/^1\b/.test(t)) return true;
  if (/^(2|3)\b/.test(t)) return false;
  return null;
}

export { textosConfirmacao };
