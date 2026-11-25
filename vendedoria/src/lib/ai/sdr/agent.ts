import { prisma } from "@/lib/prisma/client";
import { callOpenAI, callAnthropic, callGemini } from "@/lib/ai/llm-client";
import { sendWhatsAppMessage, simulateTypingDelay } from "@/lib/whatsapp/send";
import { detectDesinteresse } from "@/lib/ai/agent";
import { cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { MOTIVO } from "@/lib/crm/motivos";
import { loadSdrSession, saveSdrSession } from "./session";
import { avaliarQualificacao } from "./qualificacao";
import { decidirHandoff, faltandoParaHandoff, pareceNomeDePessoa, temHorario, type ItemHandoff } from "./handoff-gate";
import { extrairDadosFaltantes } from "./extrair-sessao";
import { perfilComunicacao } from "./estilo";
import { filtrarRepetidas, pareceFechamento, ultimasDaIA } from "./anti-repeticao";
import { forcarProximoPasso, leadPerguntou, perguntaCombinada } from "./fluxo-rapido";
import { detectarPedidoHumano, mensagemDeTransferencia, type MotivoHumano } from "./humano";
import { dadosParaEventoCrm, sincronizarQualificacaoNoLead } from "./sincronizar-crm";
import { emitirEventoCrm, emitirIntencoesDaMensagem } from "@/lib/crm-externo/eventos";
import { horarioAceitavel, rotuloSlot, type Slot } from "@/lib/agenda/slots";
import { buscarSlotsLigacao } from "@/lib/agenda/reuniao";
import { proximoEnvio } from "@/lib/followup/janela";
import { dataDoToque } from "@/lib/followup/cadencia";
import { buildSdrSystemPrompt } from "./prompt";
import { turnoAbertura, turnoJulia, turnoRespostaAutomatica, type SaidaTurno } from "./julia/motor";
import { agendarFollowup, efetivarPassagem, encerrarFollowups, enviarBaloes, marcarPrioridade, tratarPosPassagem } from "./julia/efeitos";
import { ehPrioridade } from "./julia/icp";
import { TEXTO_OPT_OUT } from "./julia/roteiro";
import { MENSAGEM_FALHA_SDR } from "./fallback";
import { deepseekAtivo, deepseekChat } from "@/lib/ai/deepseek";
import { ehApenasCortesia, TEXTO_REACAO } from "./cortesia";
import { type SDRSession, type SDRLLMResponse, SDR_EMPTY_SESSION } from "./types";
import { acquireAiLock, releaseAiLock } from "@/lib/ai/conversation-lock";

const HANDOFF_NUMBER = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

// WhatsApp entrega cada mensagem do cliente como um webhook separado. Quando o
// cliente manda 2-3 mensagens seguidas (comum em conversas por celular), cada
// uma dispara sua própria execução do SDR em paralelo — sem essa espera, o
// cliente recebia respostas duplicadas/sobrepostas, uma pra cada mensagem.
//
// IMPORTANTE: cada segundo aqui é um segundo a mais que a invocação serverless
// (e a conexão Prisma dela) fica viva. Em 27/08/26 um valor de 7000ms esgotou
// o pool de conexões do Supabase (connection_limit=1 por instância, mas em
// rajada de mensagens muitas instâncias concorrentes = pool cheio) e derrubou
// o /api/conversations do CRM inteiro. Mantenha esse valor baixo.
const DEBOUNCE_MS = Number(process.env.SDR_DEBOUNCE_MS ?? 1200);

// Falha do LLM (sem resposta ou JSON inválido) nunca deve deixar o cliente sem
// retorno nem passar em silêncio para o dono — manda uma mensagem de espera pro
// cliente e um alerta pro dono no WhatsApp + registro no CRM.
async function notifySdrFailure(
  conversationId: string,
  phoneNumberId: string,
  customerPhone: string,
  token: string | undefined,
  organizationId: string,
  leadName: string | null,
  detalhe: string,
): Promise<void> {
  const fallbackMsg = MENSAGEM_FALHA_SDR;
  try {
    await sendWhatsAppMessage(phoneNumberId, customerPhone, fallbackMsg, token);
    await prisma.whatsappMessage.create({
      data: { content: fallbackMsg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
    });
  } catch (e) {
    console.error("[SDR] Erro ao enviar mensagem de espera ao cliente:", e);
  }
  try {
    await sendWhatsAppMessage(
      phoneNumberId, HANDOFF_NUMBER,
      `⚠️ SDR falhou ao responder\n\nCliente: ${leadName ?? customerPhone} (${customerPhone})\nMotivo: ${detalhe}\n\nO cliente recebeu uma mensagem de espera automática — pode ser que precise de atendimento manual.`,
      token,
    );
  } catch (e) {
    console.error("[SDR] Erro ao notificar dono da falha:", e);
  }
  await prisma.ownerNotification.create({
    data: {
      type: "INFO",
      title: `⚠️ SDR falhou ao responder | ${leadName ?? customerPhone}`,
      body: detalhe,
      organizationId,
      conversationId,
    },
  }).catch(() => {});
}

// Campos que o LLM pode gravar na sessão. `status` e `mode` ficam de fora de
// propósito: o modelo às vezes devolvia status="handoff_enviado" junto de
// action="continue", e aí nenhum bastão era enviado, o lead não virava
// ESCALATED, mas nos turnos seguintes o próprio modelo lia a sessão e agia como
// se já tivesse passado o contato — lead qualificado perdido em silêncio.
// `status` passou a ser derivado exclusivamente de `parsed.action`, no código.
const CAMPOS_EDITAVEIS_PELO_LLM = [
  "nome", "canais_atuais", "tem_loja_fisica", "faturamento_total",
  "ja_vende_marketplace", "marketplace_atual", "problema_principal", "cnpj",
  "opera_com_equipe", "disponibilidade", "score", "rota", "produto_indicado",
  "objecoes_mencionadas", "etapa", "empresa", "segmento", "loja_fisica", "horario_reuniao",
] as const satisfies ReadonlyArray<keyof SDRSession>;

const CAMPOS_LISTA = ["canais_atuais", "marketplace_atual", "objecoes_mencionadas"] as const;

/**
 * Aplica o updateSession do LLM sobre a sessão atual sem destruir o que já foi
 * coletado. O prompt pede "apenas os campos que mudaram", mas o modelo devolve
 * com frequência o campo vazio ("nome": "") num turno em que o assunto não
 * apareceu — com spread cru isso zerava o dado e o bastão saía com
 * "Nome: não informado" mesmo tendo o nome coletado turnos antes.
 *
 * Listas são unidas em vez de substituídas: `objecoes_mencionadas` carrega o
 * alerta de risco regulatório que o especialista precisa ver no handoff, e ele
 * sumia assim que o modelo mencionava qualquer outra objeção.
 */
function mergeSdrSession(
  atual: SDRSession,
  update: Partial<SDRSession> | undefined,
): SDRSession {
  const merged: SDRSession = { ...SDR_EMPTY_SESSION, ...atual, mode: "SDR" };
  if (!update) return merged;

  for (const campo of CAMPOS_EDITAVEIS_PELO_LLM) {
    const valor = update[campo];
    if (valor === undefined || valor === null) continue;

    if ((CAMPOS_LISTA as readonly string[]).includes(campo)) {
      if (!Array.isArray(valor)) continue;
      const anterior = (merged[campo] as string[] | undefined) ?? [];
      const novos = valor.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      (merged[campo] as string[]) = Array.from(new Set([...anterior, ...novos]));
      continue;
    }

    // String vazia = "não mencionado neste turno", não "apagar o que eu sabia".
    if (typeof valor === "string" && valor.trim() === "") continue;

    (merged[campo] as unknown) = valor;
  }

  // O prompt antigo só conhecia o booleano tem_loja_fisica — e o padrão da sessão
  // vazia também é false, então "false" sozinho não dizia se o lead respondeu
  // "não" ou se ninguém perguntou. Quando o modelo manda o booleano
  // EXPLICITAMENTE neste turno, é resposta: vira loja_fisica "sim"/"nao" e o
  // portão do handoff para de pedir o que o lead já disse (caso Ana, 28/10).
  if (typeof update.tem_loja_fisica === "boolean" && !update.loja_fisica) {
    merged.loja_fisica = update.tem_loja_fisica ? "sim" : "nao";
  }

  return merged;
}

// Formato de handoff enviado ao especialista
export function formatHandoffMessage(
  phone: string,
  session: SDRSession,
  reuniao?: { label: string; meetLink?: string } | null,
): string {
  const canais: string[] = [];
  if (session.canais_atuais.length > 0) canais.push(...session.canais_atuais);
  if (session.marketplace_atual.length > 0) canais.push(...session.marketplace_atual);
  const canaisStr = canais.length > 0 ? Array.from(new Set(canais)).join(", ") : "não informado";
  const icp = avaliarQualificacao({ ...session, tem_loja_fisica: session.loja_fisica === "sim" || session.tem_loja_fisica });
  const fat = icp.faturamentoMensal != null ? `R$ ${icp.faturamentoMensal.toLocaleString("pt-BR")}/mês` : "não informado";

  return `🔥 NOVO LEAD QUALIFICADO — LIGAÇÃO MARCADA

📅 Ligação: ${reuniao?.label || session.disponibilidade?.trim() || "a combinar"}${reuniao?.meetLink ? `\n🎥 Meet: ${reuniao.meetLink}` : ""}

👤 ${session.nome || "não informado"} — ${session.empresa || "empresa não informada"}
📱 WhatsApp: +${phone}
🛍️ Vende: ${session.segmento || "não informado"}
🏪 Canais: ${canaisStr}

✅ ICP: loja física ${session.loja_fisica === "sim" || session.tem_loja_fisica ? "SIM" : "NÃO"} · faturamento ${fat} · CNPJ ${session.cnpj || "?"}
🎯 Dor: ${session.problema_principal || "não informada"}
📊 Score: ${session.score ?? 0}${session.objecoes_mencionadas.length > 0 ? `\n⚠️ Atenção: ${session.objecoes_mencionadas.join(", ")}` : ""}${session.produto_indicado ? `\n💡 Indicado: ${session.produto_indicado}` : ""}`;
}

// Notifica o especialista sobre um handoff por TODOS os canais disponíveis —
// nunca só WhatsApp.
//
// A API do WhatsApp só aceita mensagem de texto livre pra um número que
// mandou mensagem pro bot nas últimas 24h (janela de atendimento da Meta).
// Se o especialista não conversa com o próprio bot todo dia — o normal —,
// o envio falha com HTTP 400 (erro 131047) e, antes desta correção, esse
// erro era só logado: o lead virava ESCALATED no CRM mas a notificação
// nunca chegava a lugar nenhum, silenciosamente, pra QUALQUER cliente.
//
// Fix: sempre grava um OwnerNotification (aparece na CRM independente de
// canal) e sempre dispara push notification (não depende da janela da
// Meta) — o WhatsApp continua sendo tentado por ser o canal mais imediato,
// mas deixou de ser o único.
export async function notificarHandoff(
  bastao: string,
  phoneNumberId: string,
  token: string | undefined,
  organizationId: string,
  leadId: string,
  conversationId: string,
): Promise<{ whatsappOk: boolean; erroWhatsapp?: string; janelaFechada?: boolean; pendente?: boolean }> {
  // 1) O aviso fica gravado primeiro (aparece no CRM em qualquer caso e é a fila do WhatsApp).
  const aviso = await prisma.ownerNotification.create({
    data: { type: "ESCALATION", title: "🔥 Novo lead escalado", body: bastao, organizationId, leadId, conversationId },
  }).catch((e) => { console.error("[SDR] Falha ao gravar OwnerNotification:", e); return null; });

  // 2) WhatsApp: com a janela de 24 h do Pedro aberta, sai na hora; fechada, fica pendente e sai assim que ele escrever
  //    para o número (a Meta aceitava o texto e depois descartava — ver src/lib/whatsapp/aviso-dono.ts).
  const { entregarAvisoAoDono } = await import("@/lib/whatsapp/aviso-dono");
  const r = await entregarAvisoAoDono(aviso?.id ?? null, bastao, phoneNumberId, token);
  if (!r.whatsappOk && aviso) {
    await prisma.ownerNotification.update({
      where: { id: aviso.id },
      data: { title: r.janelaFechada ? "🔥 Novo lead escalado — WhatsApp sai quando você mandar uma mensagem ao número" : "🔥 Novo lead escalado (WhatsApp falhou — veja aqui)" },
    }).catch(() => {});
  }

  // 3) Push sempre (não depende da janela da Meta).
  const { sendPushToAll } = await import("@/lib/push/notificar");
  await sendPushToAll({
    title: r.whatsappOk ? "🔥 Novo lead escalado" : "🔥 Novo lead escalado — mande um 'oi' no WhatsApp do bot para receber o bastão",
    body: bastao.split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 180),
    url: `/crm/lead/kanban?leadId=${leadId}`,
    tag: `handoff-${leadId}`,
  }).catch((e) => console.error("[SDR] Falha ao enviar push do handoff:", e));

  return { whatsappOk: r.whatsappOk, erroWhatsapp: r.erroWhatsapp, janelaFechada: r.janelaFechada, pendente: r.pendente };
}

// A IA sai de cena e o Pedro assume: usado quando o lead pede uma pessoa, se
// mostra frustrado, ou quando a própria IA não tem nada novo a dizer (todas as
// respostas que ela montou já tinham sido enviadas — ou seja, travou numa
// pergunta). Antes disso não existia saída: a conversa ficava em loop até o
// lead desistir. Marca o lead como escalado (sem o bastão "NOVO LEAD", que
// exige dados completos), avisa por notificação + push + WhatsApp e cancela os
// follow-ups — ninguém quer "ficou alguma dúvida?" em cima de um lead irritado.
async function transferirParaHumano(args: {
  conversationId: string;
  motivo: MotivoHumano | "ia_travou";
  session: SDRSession;
  lead: { id: string; phoneNumber: string; profileName: string | null };
  provider: { businessPhoneNumberId: string; accessToken: string | null; organizationId: string };
  ultimaMensagem: string;
}): Promise<void> {
  const { conversationId, motivo, lead, provider, ultimaMensagem } = args;
  // Sessão pode ter sido gravada por versão antiga (sem as listas) — completa.
  const session: SDRSession = { ...SDR_EMPTY_SESSION, ...args.session, mode: "SDR" };
  const token = provider.accessToken ?? undefined;
  const now = new Date();

  // 1) Humano assume ANTES de qualquer envio — a próxima mensagem do lead já não
  //    chega à IA, mesmo que o resto desta função falhe no meio.
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { humanTakeover: true, aiLockUntil: null },
  }).catch((e) => console.error("[SDR] Falha ao marcar humanTakeover:", e));

  const nome = session.nome || (pareceNomeDePessoa(lead.profileName) ? lead.profileName : null);
  const texto = motivo === "ia_travou"
    ? `${nome ? `${nome.split(/\s+/)[0]}, ` : ""}pra não te fazer repetir nada, vou te passar direto pro Pedro — ele continua a conversa daqui 🙏`
    : mensagemDeTransferencia(motivo, nome);
  try {
    const wamid = await sendWhatsAppMessage(provider.businessPhoneNumberId, lead.phoneNumber, texto, token);
    await prisma.whatsappMessage.create({
      data: { wamid, content: texto, type: "TEXT", role: "ASSISTANT", sentAt: now, status: "SENT", conversationId },
    }).catch(() => {});
  } catch (e) {
    console.error("[SDR] Erro ao avisar o lead da transferência:", e);
  }

  // 2) Lead vira escalado no CRM (uma vez só) e vai para a coluna de handoff.
  const claim = await prisma.lead.updateMany({
    where: { id: lead.id, status: { not: "ESCALATED" } },
    data: { status: "ESCALATED", lastActivityAt: now },
  }).catch(() => ({ count: 0 }));
  const motivoTexto = motivo === "pediu_humano" ? "Lead pediu para falar com uma pessoa"
    : motivo === "frustrado" ? "Lead demonstrou frustração com a IA"
    : "IA travou (sem resposta nova para dar)";
  // Não vai para "Ligação marcada" (lá só entra quem marcou a ligação): qualificado vai para "Qualificados"; os demais ficam onde estão.
  if (session.icp === "QUALIFICADO" || session.qualificado_em) await moverLeadPorTipo(lead.id, provider.organizationId, "QUALIFICADO", `${motivoTexto} — Pedro assume a conversa`);
  await prisma.leadActivity.create({
    data: { leadId: lead.id, type: "STATUS_CHANGE", description: `${motivoTexto} — IA saiu, humano assumiu`, createdBy: "AI_AGENT" },
  }).catch(() => {});

  // 3) Follow-ups automáticos param.
  await prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "DONE" } }).catch(() => {});
  await cancelFollowUpJobs(conversationId).catch(() => {});

  // 4) Avisa o Pedro com o que já foi coletado + as últimas falas do lead.
  const ultimas = await prisma.whatsappMessage.findMany({
    where: { conversationId, role: "USER" }, orderBy: { sentAt: "desc" }, take: 3, select: { content: true },
  }).catch(() => [] as Array<{ content: string }>);
  const falas = ultimas.reverse().map((m) => `• ${m.content.slice(0, 160)}`).join("\n") || `• ${ultimaMensagem.slice(0, 160)}`;
  const resumo = `⚠️ ${motivoTexto.toUpperCase()} — assuma a conversa\n\n${formatHandoffMessage(lead.phoneNumber, session)}\n\nÚltimas mensagens do lead:\n${falas}`;
  if (claim.count > 0) {
    await notificarHandoff(resumo, provider.businessPhoneNumberId, token, provider.organizationId, lead.id, conversationId);
  } else {
    await prisma.ownerNotification.create({
      data: { type: "ESCALATION", title: `⚠️ ${motivoTexto} — assuma a conversa`, body: resumo, organizationId: provider.organizationId, leadId: lead.id, conversationId },
    }).catch(() => {});
  }

  // 5) Sessão reflete o estado final.
  const final: SDRSession = { ...session, status: "handoff_enviado", etapa: "humano_assumiu" };
  await saveSdrSession(conversationId, final).catch(() => {});
  await sincronizarQualificacaoNoLead(lead.id, final).catch(() => {});
  console.log(`[SDR] 👤 Humano assumiu (${motivo}) | lead=${lead.id} | conv=${conversationId}`);
}

// Chama o LLM com fallback chain. `deadline` (epoch ms) corta a cadeia de
// fallback assim que o orçamento de tempo da invocação (ver SDR_LLM_BUDGET_MS)
// já foi consumido — sem isso, provider configurado + até 3 fallbacks, cada um
// com timeout de 20s (LLM_TIMEOUT_MS), somavam até 80s numa ÚNICA chamada, e o
// loop externo ainda tentava de novo em cima disso.
export async function callSdrLLM(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string | null,
  aiModel?: string | null,
  deadline: number = Infinity,
): Promise<string | null> {
  const provider = aiProvider?.toUpperCase();
  const model = aiModel ?? "gpt-4o";
  const timeLeft = () => Date.now() < deadline;

  // DeepSeek primeiro quando configurada (DEEPSEEK_API_KEY); OpenAI e os demais ficam de reserva.
  if (deepseekAtivo() && timeLeft()) {
    const r = await deepseekChat(
      [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }],
      { maxTokens: 1000, temperature: 0.7, json: true, timeoutMs: Math.max(3_000, Math.min(20_000, deadline - Date.now())) },
    );
    if (r) return r;
  }

  // maxTokens 1000 (era 600) — mensagens longas do cliente (ex.: áudio transcrito)
  // levam o modelo a preencher mais campos de updateSession + mais balões de texto,
  // e um JSON cortado no meio nunca é parseável. response_format=json_object garante
  // que a OpenAI só devolva JSON sintaticamente válido (sem texto solto antes/depois).
  if (provider === "OPENAI" && process.env.OPENAI_API_KEY && timeLeft()) {
    const r = await callOpenAI(systemPrompt, history, userMessage, model, { maxTokens: 1000, temperature: 0.7, responseFormat: "json_object" });
    if (r) return r;
  }
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY && timeLeft()) {
    const r = await callAnthropic(systemPrompt, history, userMessage, model, { maxTokens: 1000 });
    if (r) return r;
  }
  // Fallback chain — cada elo checa o orçamento antes de gastar outros 20s
  if (process.env.OPENAI_API_KEY && timeLeft()) {
    const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o", { maxTokens: 1000, temperature: 0.7, responseFormat: "json_object" });
    if (r) return r;
  }
  if (process.env.ANTHROPIC_API_KEY && timeLeft()) {
    const r = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001", { maxTokens: 1000 });
    if (r) return r;
  }
  if (process.env.GOOGLE_AI_API_KEY && timeLeft()) {
    const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite", { maxTokens: 1000 });
    if (r) return r;
  }
  return null;
}

/**
 * Valida o objeto vindo do LLM.
 *
 * Duas correções sobre a versão anterior, que exigia `parsed.action` truthy:
 * - Resposta boa sem `action` era descartada nas três tentativas, o cliente
 *   recebia "tive um probleminha" e o dono um alerta falso — mesmo existindo
 *   uma resposta pronta. `action` agora cai para "continue".
 * - `messages: []` passava (Array.isArray([]) é true): nenhum balão era
 *   enviado, o cliente ficava em silêncio total, mas o código seguia movendo
 *   kanban e logando sucesso. Agora exige pelo menos um balão com texto.
 */
function validarRespostaSdr(parsed: SDRLLMResponse | null): SDRLLMResponse | null {
  if (!parsed || !Array.isArray(parsed.messages)) return null;
  const messages = parsed.messages.filter(
    (m) => m && typeof m.text === "string" && m.text.trim() !== "",
  );
  if (messages.length === 0) return null;

  const acoesValidas = ["continue", "handoff", "nurture", "close"];
  const action = acoesValidas.includes(parsed.action) ? parsed.action : "continue";
  return { ...parsed, messages, action };
}

// Parseia a resposta JSON do LLM de forma resiliente
export function parseSdrResponse(raw: string): SDRLLMResponse | null {
  const cleaned = raw.trim();
  const candidatos: string[] = [cleaned];

  // JSON dentro de bloco markdown
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) candidatos.push(jsonMatch[1].trim());

  // Primeiro objeto JSON solto no texto
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) candidatos.push(objMatch[0]);

  for (const candidato of candidatos) {
    try {
      const validado = validarRespostaSdr(JSON.parse(candidato) as SDRLLMResponse);
      if (validado) return validado;
    } catch { /* tenta o próximo formato */ }
  }

  // Texto puro (sem nenhum JSON): acontece quando a DeepSeek devolve vazio no modo JSON e a
  // tentativa seguinte, sem o modo JSON, responde só com a mensagem. Em vez de descartar e deixar
  // o lead sem resposta, vira 1 a 3 balões e a conversa continua (sem atualizar a sessão).
  // Resposta que tem "{" ou "}" é JSON quebrado/cortado: continua sendo descartada.
  if (cleaned && !/[{}]/.test(cleaned)) {
    const baloes = cleaned
      .replace(/```/g, "")
      .split(/\n+/)
      .map((l) => l.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    if (baloes.length > 0 && baloes.join(" ").length <= 700) {
      return { messages: baloes.map((text, i) => ({ text, delay: i * 1500 })), action: "continue" };
    }
  }
  return null;
}

/**
 * Coerência da sessão depois do merge: loja_fisica ↔ tem_loja_fisica, e
 * horário da ligação só se for um horário aceitável (futuro, dia útil,
 * expediente) — senão mantém o anterior.
 */
function normalizarSessao(s: SDRSession, anterior: SDRSession): SDRSession {
  const out = { ...s };
  if (out.loja_fisica === "sim") out.tem_loja_fisica = true;
  else if (out.loja_fisica === "nao") out.tem_loja_fisica = false;
  else if (out.tem_loja_fisica === true) out.loja_fisica = "sim";
  if (out.horario_reuniao && out.horario_reuniao !== anterior.horario_reuniao) {
    const ok = horarioAceitavel(out.horario_reuniao);
    out.horario_reuniao = ok ? ok.toISOString() : anterior.horario_reuniao;
  }
  return out;
}

export async function processSdrResponse(
  conversationId: string,
  userMessage: string,
  agent: {
    id: string;
    aiProvider?: string | null;
    aiModel?: string | null;
    sandboxMode?: boolean;
  },
  incomingMessageId: string,
): Promise<void> {
  const now = new Date();

  // ── Carregar contexto completo ───────────────────────────────────────────────
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: {
      lead: {
        select: { id: true, phoneNumber: true, profileName: true, status: true },
      },
      provider: {
        select: { businessPhoneNumberId: true, accessToken: true, organizationId: true },
      },
    },
  });

  if (!conversation?.lead || !conversation.provider) {
    console.error("[SDR] Conversa não encontrada ou sem lead:", conversationId);
    return;
  }

  // Identidade (nome Júlia, prompt) igual ao código — uma vez por instância, sem segurar a resposta.
  void import("./julia/identidade").then((m) => m.sincronizarIdentidadeJulia()).catch(() => {});

  // ── Depois da passagem (ligação marcada): só foto (uma vez) e troca de horário ─────────────────────────
  // Vem antes dos guards: com a ligação marcada a conversa tem humanTakeover=true e o lead está ESCALATED.
  if (conversation.lead.status !== "BLOCKED") {
    const sessaoAtual = await loadSdrSession(conversationId).catch(() => null);
    if (sessaoAtual && (sessaoAtual.etapa === "ligacao_marcada" || sessaoAtual.etapa === "remarcando")) {
      if (!(await acquireAiLock(conversationId))) return;
      try {
        await tratarPosPassagem({
          conversationId, sessao: sessaoAtual, mensagem: userMessage,
          lead: { id: conversation.lead.id, phoneNumber: conversation.lead.phoneNumber, profileName: conversation.lead.profileName },
          provedor: conversation.provider, citar: incomingMessageId, sandbox: Boolean(agent.sandboxMode),
        });
      } finally {
        await releaseAiLock(conversationId);
      }
      return;
    }
  }

  // ── Guards de segurança — mesmos do agente padrão ────────────────────────────
  if (conversation.lead.status === "ESCALATED") {
    console.log(`[SDR] Conv ${conversationId} já está ESCALATED — ignorando`);
    return;
  }
  // Respeita o opt-out: o lead pediu para não ser mais contatado, então a IA
  // não volta a puxar conversa. O atendimento humano continua possível pelo CRM.
  if (conversation.lead.status === "BLOCKED") {
    console.log(`[SDR] Lead ${conversation.lead.id} pediu opt-out — IA não responde`);
    return;
  }
  if (conversation.humanTakeover) {
    console.log(`[SDR] humanTakeover=true — ignorando conv ${conversationId}`);
    return;
  }

  const lead = conversation.lead;
  const provider = conversation.provider;
  const phone = lead.phoneNumber;
  const token = provider.accessToken ?? undefined;
  const phoneNumberId = provider.businessPhoneNumberId;

  // Serializa por conversa — ver comentário de AI_LOCK_HOLD_MS acima. Se não
  // conseguir a trava a tempo (outra execução muito longa travada na frente),
  // aborta em vez de arriscar responder em paralelo ou estourar o tempo
  // máximo da function.
  const gotLock = await acquireAiLock(conversationId);
  if (!gotLock) {
    console.warn(`[SDR] Não consegui a trava de IA pra conv ${conversationId} a tempo — abortando run de ${incomingMessageId}`);
    return;
  }

  try {
    await runSdrResponse(conversationId, userMessage, agent, incomingMessageId, now, lead, provider, phone, token, phoneNumberId);
  } finally {
    await releaseAiLock(conversationId);
  }
}

async function runSdrResponse(
  conversationId: string,
  userMessage: string,
  agent: { id: string; aiProvider?: string | null; aiModel?: string | null; sandboxMode?: boolean },
  incomingMessageId: string,
  now: Date,
  lead: { id: string; phoneNumber: string; profileName: string | null; status: string },
  provider: { businessPhoneNumberId: string; accessToken: string | null; organizationId: string },
  phone: string,
  token: string | undefined,
  phoneNumberId: string,
): Promise<void> {
  // ── Sinais de intenção da mensagem → CRM Avanteza (regras, sem chamar o modelo; em segundo plano) ──
  void emitirIntencoesDaMensagem(lead.id, userMessage).catch(() => {});

  // ── Debounce: espera o lead terminar de digitar; a mensagem mais nova responde por todas ─────────────
  const thisMessage = await prisma.whatsappMessage.findUnique({ where: { id: incomingMessageId }, select: { sentAt: true } });
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  if (thisMessage) {
    const newerCount = await prisma.whatsappMessage.count({
      where: {
        conversationId, role: "USER",
        OR: [{ sentAt: { gt: thisMessage.sentAt } }, { sentAt: thisMessage.sentAt, id: { gt: incomingMessageId } }],
      },
    });
    if (newerCount > 0) {
      console.log(`[SDR] Debounce: mensagem mais nova já chegou — abortando run de ${incomingMessageId}`);
      return;
    }
  }

  const p = provider;
  const leadRef = { id: lead.id, phoneNumber: phone, profileName: lead.profileName };
  const sandbox = Boolean(agent.sandboxMode);

  // ── Pediu para parar: desculpa em uma frase e encerra (Perdido, motivo opt-out) ──────────────────────
  if (detectDesinteresse(userMessage)) {
    console.log(`[SDR] Desinteresse/opt-out detectado — encerrando conv ${conversationId}`);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "BLOCKED" } }).catch(() => {});
    await moverLeadPorTipo(lead.id, p.organizationId, "DESCARTADO", "Lead pediu para não ser mais contatado (opt-out)", "LOST",
      { motivoEncerramento: MOTIVO.OPT_OUT, ator: "AI_AGENT", origem: "IA" });
    await prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "OPT_OUT" } }).catch(() => {});
    await cancelFollowUpJobs(conversationId).catch(() => {});
    const sess = await loadSdrSession(conversationId);
    await saveSdrSession(conversationId, { ...SDR_EMPTY_SESSION, ...sess, mode: "SDR", status: "fora" });
    await enviarBaloes(conversationId, p, phone, [TEXTO_OPT_OUT], undefined, sandbox);
    return;
  }

  let session: SDRSession = { ...SDR_EMPTY_SESSION, ...(await loadSdrSession(conversationId)), mode: "SDR" };

  // ── Reação (👍) e cortesia depois do encerramento: nada a responder ─────────────────────────────────
  if (userMessage.trim() === TEXTO_REACAO || (["handoff_enviado", "fora", "morno"].includes(session.status) && ehApenasCortesia(userMessage))) return;

  // ── Histórico (cronológico) ──────────────────────────────────────────────────────────────────────────
  const recentMessages = (await prisma.whatsappMessage.findMany({
    where: { conversationId }, orderBy: { sentAt: "desc" }, take: 20, select: { id: true, content: true, role: true },
  })).reverse();
  const history = recentMessages.filter((m) => m.id !== incomingMessageId).map((m) => ({ role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant", content: m.content }));
  const anteriorDoLead = [...recentMessages].reverse().find((m) => m.role === "USER" && m.id !== incomingMessageId)?.content ?? null;

  // ── Resposta automática (ex.: "‎Iharla Closet agradece seu contato…"): não responde, pausa 24 h ────────
  const auto = turnoRespostaAutomatica(session, userMessage, anteriorDoLead, now);
  if (auto) {
    await saveSdrSession(conversationId, auto.sessao).catch(() => {});
    if (auto.acao === "auto_resposta_pausa") {
      // uma retomada só, dentro da janela de 24 h do WhatsApp (o follow-up manda "Acho que caiu na resposta automática")
      await agendarFollowup(conversationId, p, leadRef, now, new Date(now.getTime() + 23 * 3_600_000)).catch(() => {});
      console.log(`[Júlia] Resposta automática detectada — IA pausada por 24 h | conv=${conversationId}`);
    } else if (auto.acao === "auto_resposta_parar") {
      await encerrarFollowups(conversationId);
      await moverLeadPorTipo(lead.id, p.organizationId, "LOST", "Só respostas automáticas — Júlia parou", undefined,
        { motivoEncerramento: MOTIVO.RESPOSTA_AUTOMATICA, ator: "AI_AGENT", origem: "IA" });
      console.log(`[Júlia] Resposta automática de novo — conversa encerrada | conv=${conversationId}`);
    }
    return;
  }
  // Uma pessoa respondeu depois da resposta automática: segue o roteiro normalmente.
  if (session.auto_resposta) session = { ...session, auto_resposta: undefined };

  // ── Pediu uma pessoa / frustrado → Pedro assume ─────────────────────────────────────────────────────
  const motivoHumano = detectarPedidoHumano(userMessage);
  if (motivoHumano) {
    await transferirParaHumano({ conversationId, motivo: motivoHumano, session, lead, provider, ultimaMensagem: userMessage });
    return;
  }

  try {
    const { markWhatsAppMessageRead } = await import("@/lib/whatsapp/send");
    await markWhatsAppMessageRead(phoneNumberId, incomingMessageId, token);
  } catch { /* não crítico */ }

  // ── Turno do roteiro ─────────────────────────────────────────────────────────────────────────────────
  const primeira = !recentMessages.some((m) => m.role === "ASSISTANT") && (session.etapa === "boas_vindas" || !session.abertura);
  let saida: SaidaTurno;
  if (primeira) {
    saida = turnoAbertura(session, userMessage);
  } else {
    const slots: Slot[] = await buscarSlotsLigacao(p.organizationId, 2, now).catch(() => []);
    const systemPrompt = buildSdrSystemPrompt(session, lead.profileName, { slots });
    const llmDeadline = Date.now() + 30_000;
    let raw: string | null = null;
    for (let attempt = 0; attempt < 2 && Date.now() < llmDeadline; attempt++) {
      raw = await callSdrLLM(systemPrompt, history, userMessage, agent.aiProvider, agent.aiModel, llmDeadline);
      if (raw) break;
    }
    const parsed = raw ? parseSdrResponse(raw) : null;
    if (!parsed) console.error(`[Júlia] Modelo sem resposta válida — seguindo com os textos fixos do roteiro | conv=${conversationId}`);
    saida = turnoJulia({ sessao: session, mensagem: userMessage, llm: parsed, slotsLivres: slots, agora: now, nomePerfil: lead.profileName });
  }

  // ── Ligação escolhida → passagem para o Pedro ─────────────────────────────────────────────────────────
  if (saida.acao === "marcar_ligacao") {
    await saveSdrSession(conversationId, saida.sessao).catch(() => {});
    await efetivarPassagem({ conversationId, sessao: saida.sessao, slotIso: saida.slotEscolhido ?? null, lead: leadRef, provedor: p, citar: incomingMessageId, sandbox, agora: now });
    return;
  }

  // ── Nunca repete ao lead o que acabou de dizer (texto fixo repetido vira "Só pra confirmar: …") ────────
  const jaEnviadas = ultimasDaIA(recentMessages, 6);
  let mensagens = filtrarRepetidas(saida.mensagens.map((text) => ({ text, delay: 0 })), jaEnviadas).map((m) => m.text);
  if (!mensagens.length && saida.mensagens.length) {
    const ult = saida.mensagens[saida.mensagens.length - 1];
    mensagens = [`Só pra confirmar: ${ult.charAt(0).toLowerCase()}${ult.slice(1)}`];
  }
  await saveSdrSession(conversationId, saida.sessao).catch((e) => console.error("[SDR] Falha ao salvar sessão parcial:", e));
  await enviarBaloes(conversationId, p, phone, mensagens, incomingMessageId, sandbox);

  // ── Efeitos no CRM ───────────────────────────────────────────────────────────────────────────────────
  const s = saida.sessao;
  switch (saida.acao) {
    case "fora":
      await moverLeadPorTipo(lead.id, p.organizationId, "FORA_ICP", "Sem loja e sem estoque próprio — rota FORA", undefined,
        { motivoEncerramento: MOTIVO.FORA_ICP, ator: "AI_AGENT", origem: "IA", dadosCrm: dadosParaEventoCrm(s) });
      await encerrarFollowups(conversationId);
      break;
    case "morno":
      await moverLeadPorTipo(lead.id, p.organizationId, "MORNO", "Tem loja/estoque, sem CNPJ — rota MORNO", undefined, { dadosCrm: dadosParaEventoCrm(s) });
      await encerrarFollowups(conversationId);
      break;
    case "oferecer_horarios":
      if (!session.qualificado_em) {
        await moverLeadPorTipo(lead.id, p.organizationId, "QUALIFICADO", "Qualificado pela Júlia (loja/estoque + CNPJ) — horários oferecidos", undefined, { dadosCrm: dadosParaEventoCrm(s) });
      }
      if (ehPrioridade(s)) await marcarPrioridade(lead.id, p.organizationId).catch(() => {});
      await agendarFollowup(conversationId, p, leadRef, now).catch(() => {});
      break;
    default:
      // abertura / perguntar: em qualificação (quem já foi qualificado não volta)
      if (!s.qualificado_em) await moverLeadPorTipo(lead.id, p.organizationId, "EM_QUALIFICACAO");
      await agendarFollowup(conversationId, p, leadRef, now).catch(() => {});
      break;
  }

  await saveSdrSession(conversationId, s);
  await sincronizarQualificacaoNoLead(lead.id, s);
  await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { updatedAt: now } }).catch(() => {});
  console.log(`[Júlia] ✅ ${saida.acao} | icp=${saida.icp} | conv=${conversationId}`);
}

// ─── Bastão atrasado ─────────────────────────────────────────────────────────
// Para lead que a IA já deixou esperando uma ligação ("vou te conectar com o Pedro…") mas cujo
// handoff nunca foi executado — o caso de 17/11/2026, quando o portão bloqueava por um dado que o
// lead tinha dado por texto e a despedida saía assim mesmo. Faz o mesmo que o handoff normal
// (escala o lead, avisa o Pedro por WhatsApp + notificação + push, move o card e cancela os
// follow-ups), recuperando antes da conversa o que o modelo não gravou. Não escreve ao lead.
export async function passarBastaoRecuperado(leadId: string): Promise<{ ok: boolean; motivo: string }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, phoneNumber: true, profileName: true, status: true } });
  if (!lead) return { ok: false, motivo: "lead não encontrado" };
  if (lead.status === "ESCALATED" || lead.status === "BLOCKED") return { ok: false, motivo: `lead já está ${lead.status}` };

  const conv = await prisma.whatsappConversation.findFirst({
    where: { leadId },
    select: {
      id: true,
      provider: { select: { businessPhoneNumberId: true, accessToken: true, organizationId: true } },
    },
  });
  if (!conv?.provider) return { ok: false, motivo: "sem conversa/provedor" };
  const provider = conv.provider;

  let session: SDRSession = { ...SDR_EMPTY_SESSION, ...(await loadSdrSession(conv.id)), mode: "SDR" };
  const mensagens = await prisma.whatsappMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { sentAt: "desc" },
    take: 24,
    select: { role: true, content: true },
  });
  const conversa = mensagens.reverse().map((m) => ({ role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant", content: m.content }));

  const antes = faltandoParaHandoff(session);
  if (antes.length > 0) {
    const extra = await extrairDadosFaltantes(antes, conversa, 15_000);
    if (Object.keys(extra).length > 0) session = normalizarSessao(mergeSdrSession(session, extra), session);
  }
  const faltou = faltandoParaHandoff(session);

  // Reivindica o handoff de forma atômica: só uma execução leva count===1.
  const claim = await prisma.lead.updateMany({
    where: { id: lead.id, status: { notIn: ["ESCALATED", "BLOCKED"] } },
    data: { status: "ESCALATED", lastActivityAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, motivo: "handoff já realizado" };

  session = { ...session, status: "handoff_enviado", etapa: "humano_assumiu" };
  const bastao =
    `♻️ BASTÃO ATRASADO — a IA prometeu seu contato a este lead e o aviso não tinha saído.\n\n` +
    formatHandoffMessage(lead.phoneNumber, session, null) +
    (faltou.length > 0 ? `\n\n❓ Ainda não informado pelo lead: ${faltou.join(", ")}` : "");
  await notificarHandoff(bastao, provider.businessPhoneNumberId, provider.accessToken ?? undefined, provider.organizationId, lead.id, conv.id);

  await moverLeadPorTipo(
    lead.id, provider.organizationId, "ESCALATED", "Lead escalado para especialista (bastão recuperado)", "ESCALATED",
    { dadosCrm: dadosParaEventoCrm(session) },
  ).catch((e) => console.error("[SDR] Bastão recuperado: falha ao mover o card:", e));
  await prisma.leadActivity.create({
    data: { leadId: lead.id, type: "STATUS_CHANGE", description: "Lead escalado para especialista (bastão recuperado)", createdBy: "AI_AGENT" },
  }).catch(() => {});
  await prisma.conversationFollowUp.updateMany({ where: { conversationId: conv.id, status: "ACTIVE" }, data: { status: "DONE" } }).catch(() => {});
  await cancelFollowUpJobs(conv.id).catch(() => {});
  await saveSdrSession(conv.id, session).catch(() => {});
  await sincronizarQualificacaoNoLead(lead.id, session).catch(() => {});
  console.log(`[SDR] Bastão recuperado | lead=${lead.id} | falta=${faltou.join(",") || "nada"}`);
  return { ok: true, motivo: faltou.length ? `escalado (faltou: ${faltou.join(", ")})` : "escalado" };
}
