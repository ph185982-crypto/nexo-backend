import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppVideo, simulateTypingDelay, sendTypingIndicator, markWhatsAppMessageRead } from "@/lib/whatsapp/send";
import { productSourcingService } from "@/lib/ai/product-sourcing";
import { decisionService } from "@/lib/ai/decision";
import { promptCompiler } from "@/lib/ai/prompt-compiler";
import { enqueueFollowUp, cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { notificarPassagem, notificarLeadQuente, notificarEscalacao } from "@/lib/push/notificar";
import { buscarProdutosAtivos, formatarProdutosParaContexto } from "@/lib/ai/contexto-produtos";
import { buscarSessaoNacional, atualizarSessaoNacional } from "@/lib/ai/sessao-nacional";
import { buscarSessaoProspeccao, atualizarSessaoProspeccao, type SessaoProspeccao } from "@/lib/ai/sessao-prospeccao";
import { criarEventoReuniao, verificarDisponibilidade, buscarSlotsDisponiveis } from "@/lib/integrations/google-calendar";
import { config } from "@/lib/config/env";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";

// ─── Follow-up intervals ─────────────────────────────────────────────────────
const FOLLOWUP_INTERVALS_MS = [
  4  * 60 * 60 * 1000,  // step 1 — 4h
  24 * 60 * 60 * 1000,  // step 2 — 24h
  48 * 60 * 60 * 1000,  // step 3 — 48h
  72 * 60 * 60 * 1000,  // step 4 — 72h
];

interface AgentConfig {
  id: string;
  systemPrompt?: string | null;
  kind: string;
  status: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  sandboxMode?: boolean;
  escalationThreshold?: number | null;
}

interface LeadState {
  tipo: "curioso" | "interessado" | "quente" | "frio";
  urgencia: "baixa" | "media" | "alta";
}

interface AIResponse {
  mensagens: string[];
  delays: number[];
}

// ── URL base pública do app ───────────────────────────────────────────────────
function getBaseUrl(): string {
  return (
    process.env.RENDER_EXTERNAL_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "")
  ).replace(/\/$/, "");
}

// ── Notificação de erro crítico para o dono ───────────────────────────────────
async function notificarErroCritico(
  mensagem: string,
  phoneNumberId: string,
  accessToken: string | undefined,
): Promise<void> {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
  try {
    await sendWhatsAppMessage(phoneNumberId, ownerNumber, `⚠️ ERRO CRÍTICO — IA\n${mensagem}`, accessToken);
  } catch {
    console.error("[ALERTA] Falha ao notificar Pedro:", mensagem);
  }
}

// ── Detecção de estado do lead ────────────────────────────────────────────────
function detectLeadState(message: string): LeadState {
  const msg = message.toLowerCase();
  if (/quero\b|como\s+compra|entrega\s+quando|pronta\s+entrega|vou\s+comprar|quero\s+comprar|fechar|confirmar|fazer\s+pedido|finalizar|bora|fechado|pode\s+ser|t[oô]\s+dentro/.test(msg)) {
    return { tipo: "quente", urgencia: "alta" };
  }
  if (/quanto\s+custa|qual\s+o\s+pre[çc]o|qual\s+o\s+valor|pre[çc]o|valor|como\s+funciona|tem\s+dispon[ií]vel|tem\s+estoque|parcel|to\s+interessado|tô\s+interessado|interesse|gostei/.test(msg)) {
    return { tipo: "interessado", urgencia: "media" };
  }
  if (/depois|vou\s+ver|talvez|n[aã]o\s+sei|to\s+vendo|t[oô]\s+vendo|ta\s+caro|t[aá]\s+caro|muito\s+caro|caro\s+demais/.test(msg)) {
    return { tipo: "frio", urgencia: "baixa" };
  }
  return { tipo: "curioso", urgencia: "baixa" };
}

// ── Extrai dados já coletados na conversa (evita perguntar de novo) ────────────
interface CollectedData {
  localizacao?: string;
  endereco?: string;
  pagamento?: string;
  horario?: string;
  nome?: string;
  cep?: string;
}

function extractCollectedData(messages: Array<{ role: string; content: string }>): CollectedData {
  const data: CollectedData = {};
  const allText = messages.map((m) => m.content).join("\n").toLowerCase();

  // ── Localização ───────────────────────────────────────────────────────────
  // Detecta: pin nativo WhatsApp, qualquer link Maps, CEP, texto com rua/av
  // UMA VEZ DETECTADA, nunca mais pedir — coloca em AMBOS localizacao e endereco
  const locMsg = messages.find((m) =>
    /\[Localiza[çc][aã]o\s+recebida\]/.test(m.content) ||         // pin nativo
    /lat:[-\d.]+\s+lng:[-\d.]+/.test(m.content) ||                 // coordenadas
    /maps\.google\.com/.test(m.content) ||                          // google maps
    /maps\.app\.goo\.gl/.test(m.content) ||                        // short link maps
    /goo\.gl\/maps/.test(m.content) ||                             // outro short
    /\bwaze\.com\b/.test(m.content)                                 // waze
  );
  if (locMsg) {
    data.localizacao = locMsg.content;
    data.endereco = locMsg.content; // localização basta — não pedir endereço de novo
  } else {
    // Texto com endereço escrito (rua, av, setor, CEP, bairro)
    const endMsg = messages.find((m) =>
      m.role === "USER" && (
        /\b(rua|av\.?|avenida|travessa|alameda|setor|quadra|lote)\b.{3,}/i.test(m.content) ||
        /\b\d{5}[-\s]?\d{3}\b/.test(m.content) ||   // CEP 00000-000 ou 00000000
        /\b(goiania|goiânia|aparecida|senador|trindade|anapolis|anapolís)\b/i.test(m.content)
      ) && m.content.length > 10
    );
    if (endMsg) {
      data.localizacao = endMsg.content;
      data.endereco = endMsg.content;
    }
  }

  // ── Pagamento ─────────────────────────────────────────────────────────────
  if (/\bdinheiro\b/.test(allText)) data.pagamento = "dinheiro";
  else if (/\bpix\b/.test(allText)) data.pagamento = "pix";
  else if (/\bcart[aã]o\b/.test(allText)) data.pagamento = "cartão";

  // ── Horário de recebimento ────────────────────────────────────────────────
  const horarioMsg = messages.find((m) =>
    m.role === "USER" && /\b(\d{1,2})\s*[h:]\s*(\d{0,2})|(até|ate)\s+\d/.test(m.content)
  );
  if (horarioMsg) data.horario = horarioMsg.content;

  // ── Nome de quem recebe ───────────────────────────────────────────────────
  // Detecta APENAS apresentações explícitas — nunca infere de mensagens curtas genéricas
  const nomePatterns = [
    /(?:meu\s+nome\s+[eé]|nome\s+[eé]|pode\s+colocar\s+no\s+nome\s+(?:de|do|da)?|chamo[-\s]+me\s+|me\s+chamo\s+|sou\s+(?:o|a)\s+)\s*([A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,}(?:\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,})*)/i,
    /pode\s+(?:anotar|colocar|botar)\s+(?:como|no\s+nome\s+de)?\s*([A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,}(?:\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,})*)/i,
  ];
  let nomeFound: string | undefined;
  for (const m of messages) {
    if (m.role !== "USER") continue;
    for (const re of nomePatterns) {
      const match = re.exec(m.content);
      if (match?.[1] && match[1].trim().length >= 3) { nomeFound = match[1].trim(); break; }
    }
    if (nomeFound) break;
  }
  if (nomeFound) data.nome = nomeFound;

  return data;
}

// ── Detecta pedido de múltiplos dados de endereço de uma vez ─────────────────
function isOverloadedRequest(msg: string): boolean {
  const fields = [
    /endere[çc]o/i,
    /\bcep\b/i,
    /telefone|fone|celular|whatsapp/i,
    /nome\s+completo/i,
    /\bbairro\b/i,
    /me\s+passa\s+(seu|o)/i,
    /finalizar\s+o\s+pedido/i,
    /confirmar\s+o\s+pedido/i,
  ];
  return fields.filter((re) => re.test(msg)).length >= 2;
}

// ── Escalada automática (hard triggers — independente do LLM) ────────────────
interface EscalationSignal {
  shouldEscalate: boolean;
  reason: string;
}

function detectHardEscalation(
  message: string,
  recentMessages: Array<{ role: string; content: string }>,
): EscalationSignal {
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x00-\x7F]/g, "?");
  const msg = normalize(message);
  console.log(`[ESCALATION-DETAIL] msg normalizada: "${msg}" | histórico size: ${recentMessages.length}`);

  // 1. Cliente pede explicitamente falar com humano
  // Exige frases completas — "caro" ou "oi" nunca disparam isso
  if (
    /falar\s+com\s+(o\s+)?(pedro|humano|pessoa|atendente|vendedor|dono|responsavel|gerente|alguem)/.test(msg) ||
    /chama\s+(o\s+|um\s+|uma\s+)?(pedro|dono|atendente|gerente|alguem)/.test(msg) ||
    /quero\s+(falar\s+com\s+)?(um\s+)?(humano|pessoa\s+real|atendente|vendedor\s+humano)/.test(msg) ||
    /me\s+passa\s+(pro|para\s+o)\s+(pedro|dono|atendente)/.test(msg) ||
    /quero\s+um\s+atendente/.test(msg) ||
    /fala\s+com\s+alguem/.test(msg)
  ) {
    return { shouldEscalate: true, reason: "Cliente pediu atendimento humano explicitamente" };
  }

  // 2. Ameaca legal (palavras-chave exatas — nao dispara por "caro" ou reclamacao genérica)
  if (
    /\bprocon\b/.test(msg) ||
    /vou\s+te\s+processar/.test(msg) ||
    /vou\s+registrar\s+boletim/.test(msg) ||
    /\btribunal\s+do\s+consumidor\b/.test(msg) ||
    /vou\s+no\s+reclame\s+aqui/.test(msg) ||
    /processo\s+judicial/.test(msg)
  ) {
    return { shouldEscalate: true, reason: "Ameaca legal mencionada" };
  }

  // 3. Raiva persistente: 3+ das últimas 4 msgs do cliente com linguagem agressiva REAL
  // Nao inclui "caro", "sem dinheiro" ou qualquer objecao de preco
  const lastUserMsgs = recentMessages
    .filter((m) => m.role === "USER")
    .slice(-4)
    .map((m) => normalize(m.content));
  const angerKeywords =
    /\b(absurdo|ridiculo|pessimo|horrivel|lamentavel|incompetente|nao\s+presta|me\s+enganaram|fui\s+enganado|golpe|fraude|vergonha)\b|cade\s+meu\s+dinheiro|nunca\s+mais\s+compro/;
  const angryMsgCount = lastUserMsgs.filter((m) => angerKeywords.test(m)).length;
  if (angryMsgCount >= 3) {
    return { shouldEscalate: true, reason: "Raiva persistente: 3+ mensagens com linguagem agressiva" };
  }

  // 4. Problema pos-venda CONFIRMADO — so dispara se pedido ja foi fechado ([PASSAGEM] no historico)
  const conversationText = recentMessages.map((m) => m.content).join(" ");
  const hadSale = /\[PASSAGEM\]|\bpedido encaminhado\b/i.test(conversationText);
  if (
    hadSale &&
    (
      /veio\s+(errado|quebrado|diferente)/.test(msg) ||
      /nao\s+entregaram/.test(msg) ||
      /nao\s+chegou/.test(msg) ||
      /produto\s+(com\s+defeito|quebrado|errado|danificado)/.test(msg) ||
      /quero\s+(devolver|reembolso|meu\s+dinheiro\s+de\s+volta|estorno)/.test(msg)
    )
  ) {
    return { shouldEscalate: true, reason: "Problema pos-venda apos pedido confirmado" };
  }

  // REMOVIDO: threshold por numero de mensagens (causava escalada indevida em testes)

  return { shouldEscalate: false, reason: "" };
}

// ── TASK 2: Desinteresse explícito (Anti-Zumbi) ──────────────────────────────
// Detecta sinais claros de rejeição/opt-out. Não confunde com objeção de preço.
function detectDesinteresse(message: string): boolean {
  const n = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");
  const msg = n(message);
  return (
    /\bnao\s+quero\b/.test(msg) ||
    /\bnao\s+tenho\s+interesse\b/.test(msg) ||
    /\bnao\s+preciso\b/.test(msg) ||
    /\bnao\s+me\s+interessa\b/.test(msg) ||
    /\bnao\s+quero\s+mais\b/.test(msg) ||
    /\bpode\s+parar\b/.test(msg) ||
    /\bpara\s+de\s+(mandar|enviar)\b/.test(msg) ||
    /\bnao\s+mand[ae]\s+mais\b/.test(msg) ||
    /\bme\s+tira\s+(da\s+lista|da\s+conversa|daqui)\b/.test(msg) ||
    /\bme\s+remove\b/.test(msg) ||
    /\bchega\s+de\s+(mensagem|contato|propaganda)\b/.test(msg) ||
    /\bpara\s+de\s+me\s+incomodar\b/.test(msg) ||
    /\[OPT_OUT\]/i.test(message)
  );
}

// ── Detecção de área de entrega ──────────────────────────────────────────────
// Só dispara quando o cliente informa explicitamente que é de outra cidade/estado.
// Suporta negação: "não sou de goiânia" → fora da área.
function detectForaDeArea(message: string): boolean {
  const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const norm = n(message);

  // Exige contexto de localização pessoal do cliente
  const temContextoLocal = /\b(sou de|sou do|sou da|sou la de|sou la|moro em|fico em|estou em|to de|minha cidade|vivo em|resido em|meu bairro|minha regiao|na minha cidade)\b/.test(norm);
  if (!temContextoLocal) return false;

  const temNegacao = /\b(nao sou|nao moro|nao fico|nao estou|nao to|nao vivo|nao resido|fora de|fora da)\b/.test(norm);

  // Cidades da área de entrega
  const mencionaCidadeLocal = /\b(goiania|goias|aparecida de goiania|senador canedo|trindade|goianira|neropolis|hidrolandia|guapo|aragoiania|anapolis|bonfinopolis|terezopolis)\b/.test(norm);
  if (mencionaCidadeLocal) {
    // "nao sou de goiania" → fora; "sou de goiania" → dentro
    return temNegacao;
  }

  // Estados fora de Goiás — por nome completo normalizado
  const foraEstado = /\b(acre|alagoas|amapa|amazonas|bahia|ceara|distrito federal|espirito santo|maranhao|mato grosso do sul|mato grosso|minas gerais|paraiba|parana|pernambuco|piaui|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|roraima|santa catarina|sao paulo|sergipe|tocantins)\b/.test(norm);
  if (foraEstado) return true;

  // Grandes cidades claramente fora de Goiás
  const foraCidade = /\b(brasilia|belo horizonte|salvador|manaus|fortaleza|recife|porto alegre|curitiba|belem|joao pessoa|natal|teresina|campo grande|maceio|macapa|porto velho|boa vista|florianopolis|vitoria|cuiaba|palmas|aracaju|campinas|guarulhos|ribeirao preto|uberlandia|contagem)\b/.test(norm);
  if (foraCidade) return true;

  return false;
}

// ── CORREÇÃO 3: Detecta mensagem de cortesia pós-confirmação ─────────────────
// Mensagens curtas de agradecimento/confirmação não merecem resposta após pedido fechado.
function isCourtesyMessage(message: string): boolean {
  const norm = message.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /^(ok|oi|sim|nao|obrigado|obrigada|valeu|vlw|vlr|top|boa|show|certo|entendi|combinado|perfeito|blz|blzinha|beleza|otimo|😊|👍|🙏|✅|❤️|🙌|👏|k+|haha+|huhu|rs+|\.)$/.test(norm);
}

// ── Sanitiza mensagens — remove sobrecarga de dados ───────────────────────────
function sanitizeMessages(msgs: string[]): string[] {
  return msgs.map((m) => {
    if (isOverloadedRequest(m)) return "me manda sua localização 📍";
    return m;
  });
}

// ── Concatena mensagens incompletas que terminam com "..." ────────────────────
// Garante que nenhuma mensagem seja enviada no meio de uma ideia.
function mergeIncomplete(msgs: string[], delays: number[]): AIResponse {
  const outMsgs: string[] = [];
  const outDelays: number[] = [];
  let buf = "";
  let bufDelay = 0;
  for (let i = 0; i < msgs.length; i++) {
    if (!buf) bufDelay = delays[i] ?? 0;
    buf = buf ? `${buf} ${msgs[i]}` : msgs[i];
    if (!buf.trimEnd().endsWith("...")) {
      outMsgs.push(buf.trim());
      outDelays.push(bufDelay);
      buf = "";
    }
  }
  if (buf.trim()) { outMsgs.push(buf.trim()); outDelays.push(bufDelay); }
  return { mensagens: outMsgs, delays: outDelays };
}

// ── Parser da resposta JSON do LLM ────────────────────────────────────────────
function parseAIResponse(raw: string): AIResponse {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const tryParseJson = (s: string): AIResponse | null => {
    try {
      const parsed = JSON.parse(s) as { mensagens?: unknown; delays?: unknown };
      if (Array.isArray(parsed.mensagens) && parsed.mensagens.length > 0) {
        const msgs: string[] = (parsed.mensagens as unknown[]).map((m) => String(m).trim()).filter(Boolean);
        const rawDelays = Array.isArray(parsed.delays) ? (parsed.delays as unknown[]) : [];
        const delays: number[] = msgs.map((_, i) =>
          typeof rawDelays[i] === "number" ? (rawDelays[i] as number) : i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500
        );
        return mergeIncomplete(sanitizeMessages(msgs), delays);
      }
    } catch { /* fall through */ }
    return null;
  };

  // 1. Tenta parse direto
  const direct = tryParseJson(stripped);
  if (direct) {
    console.log(`[PARSE] JSON parseado com sucesso: ${direct.mensagens.length} msg(s)`);
    return direct;
  }

  // 2. Tenta extrair JSON embutido no texto (LLM colocou texto antes do JSON)
  const jsonMatch = stripped.match(/\{[\s\S]*"mensagens"[\s\S]*\}/);
  if (jsonMatch) {
    const embedded = tryParseJson(jsonMatch[0]);
    if (embedded) {
      console.log(`[PARSE] JSON extraído de texto: ${embedded.mensagens.length} msg(s)`);
      return embedded;
    }
  }

  // 3. Fallback: separador ||
  const byPipe = stripped.split("||").map((m) => m.trim()).filter(Boolean);
  if (byPipe.length > 1) {
    const delays = byPipe.map((_, i) => (i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500));
    return mergeIncomplete(sanitizeMessages(byPipe), delays);
  }

  console.warn(`[PARSE] Resposta não é JSON válido — enviando como texto: "${stripped.substring(0, 100)}"`);
  return mergeIncomplete(sanitizeMessages([stripped]), [0]);
}

// ── Horário em São Paulo + verifica expediente ────────────────────────────────
function getSaoPauloTime(): { hour: number; minute: number; dayOfWeek: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric", minute: "numeric", weekday: "narrow", hour12: false,
  }).formatToParts(now);
  const hour   = parseInt(fmt.find((p) => p.type === "hour")?.value   ?? "0");
  const minute = parseInt(fmt.find((p) => p.type === "minute")?.value ?? "0");
  // 0=Dom 1=Seg ... 6=Sab via JS Date in SP timezone
  const spDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dayOfWeek = spDate.getDay(); // 0=Sun,1=Mon,...,6=Sat
  return { hour, minute, dayOfWeek };
}

function isBusinessHours(hour: number, dayOfWeek: number): boolean {
  if (dayOfWeek >= 1 && dayOfWeek <= 5) return hour >= 9 && hour < 18; // Seg-Sex 9-18h
  if (dayOfWeek === 6) return hour >= 8 && hour < 13;                   // Sáb 8-13h
  return false;
}

// ── Saudação baseada no horário real de Brasília ──────────────────────────────
function saudacao(): string {
  // toLocaleString em "en-US" retorna data no fuso correto para extrair getHours()
  const spDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const h = spDate.getHours();
  if (h >= 5 && h < 12) return "bom dia";
  if (h >= 12 && h < 18) return "boa tarde";
  return "boa noite";
}

// ── Conta tentativas de quebra de objeção de preço já feitas pela IA ─────────
function countPriceObjectionAttempts(messages: Array<{ role: string; content: string }>): number {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");

  // Detecta mensagens do cliente com objeção de preço
  const clientPriceObjMsgs = messages.filter(
    (m) => m.role === "USER" && /\b(caro|muito\s+caro|caro\s+demais|ta\s+caro|sem\s+dinheiro|nao\s+tenho\s+dinheiro|preco\s+alto|nao\s+tenho\s+grana)\b/.test(normalize(m.content))
  );
  if (clientPriceObjMsgs.length === 0) return 0;

  // Conta respostas da IA após objeções de preço (aproximado: nº de objeções = nº de tentativas)
  const aiResponsesAfterObjection = messages.filter(
    (m) => m.role === "ASSISTANT" && /\b(parcela|cartao|10x|garantia|risco|paga\s+na\s+entrega|paga\s+so\s+quando|ferragem|loja|estoque|acabando)\b/.test(normalize(m.content))
  );
  return Math.min(aiResponsesAfterObjection.length, 5);
}

// ── Contexto de runtime injetado no prompt a cada chamada ────────────────────
function buildRuntimeContext(
  leadState: LeadState,
  msgCount: number,
  isFirstInteraction: boolean,
  aiConfig: { usarEmoji: boolean; usarReticencias: boolean; nivelVenda: string } | null,
  collectedData: CollectedData,
  recentMessages?: Array<{ role: string; content: string }>,
  activeProducts?: Array<{ id: string; name: string; imageUrl?: string | null; videoUrl?: string | null }>,
): string {
  const { hour, dayOfWeek } = getSaoPauloTime();
  const greeting = saudacao(); // usa fuso America/Sao_Paulo — nunca "bom dia" à meia-noite
  const emoji    = aiConfig?.usarEmoji !== false;
  const nivel    = aiConfig?.nivelVenda ?? "medio";
  const dentroDoExpediente = isBusinessHours(hour, dayOfWeek);

  const entregaHoje = dentroDoExpediente
    ? "entrega pode ser HOJE — confirmar horário com o cliente"
    : "fora do expediente (seg-sex 9-18h, sáb 8-13h) — ofereça agendar para o próximo dia útil";

  // ── Dados já coletados (não perguntar de novo) ──────────────────────────────
  const coletados: string[] = [];
  if (collectedData.localizacao) {
    coletados.push(`✅ LOCALIZAÇÃO RECEBIDA: "${collectedData.localizacao.substring(0, 100)}" — PROIBIDO pedir localização de novo`);
  }
  if (collectedData.endereco && collectedData.endereco !== collectedData.localizacao) {
    coletados.push(`✅ Endereço confirmado: ${collectedData.endereco.substring(0, 80)}`);
  }
  if (collectedData.pagamento)   coletados.push(`✅ Pagamento: ${collectedData.pagamento}`);
  if (collectedData.horario)     coletados.push(`✅ Horário: ${collectedData.horario}`);
  if (collectedData.nome)        coletados.push(`✅ Nome: ${collectedData.nome}`);
  const dadosColetados = coletados.length > 0
    ? `\nDADOS JÁ COLETADOS — NÃO PERGUNTAR DE NOVO:\n${coletados.join("\n")}`
    : "";

  // ── Tentativas de quebra de objeção de preço já feitas ──────────────────────
  const priceAttempts = recentMessages ? countPriceObjectionAttempts(recentMessages) : 0;
  // Informa à IA quantas tentativas de objeção de preço já foram feitas
  // mas NUNCA sugere escalar — escalada por preço está completamente removida
  const priceInfo = priceAttempts > 0
    ? `\nOBJEÇÃO DE PREÇO: você já fez ${priceAttempts} tentativa(s) de quebra. ${priceAttempts < 5 ? `Ainda tem ${5 - priceAttempts} tentativa(s). Varie o argumento.` : "Já tentou bastante. Tente um ângulo diferente — benefício, praticidade, entrega. NUNCA escale por preço."}`
    : "";

  // Flags de mídia disponíveis para o script usar
  const mediaFlags = (activeProducts ?? [])
    .filter((p) => p.imageUrl || p.videoUrl)
    .map((p) => {
      const s = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      return `[FOTO_${s}]${p.videoUrl ? ` / [VIDEO_${s}]` : ""}`;
    })
    .join("  |  ");

  // Dados pendentes de coleta (lead quente)
  const faltaLinhas: string[] = [];
  if (leadState.tipo === "quente") {
    const temLocal = !!(collectedData.localizacao || collectedData.endereco);
    if (!temLocal)                faltaLinhas.push("localização");
    if (!collectedData.horario)   faltaLinhas.push("horário para receber");
    if (!collectedData.pagamento) faltaLinhas.push("forma de pagamento");
    if (!collectedData.nome)      faltaLinhas.push("nome do recebedor");
  }

  return [
    `\n\n--- CONTEXTO RUNTIME ---`,
    `Hora SP: ${hour}h (${greeting}) | ${dentroDoExpediente ? "✅ Expediente" : "🔴 Fora do expediente (seg-sex 9-18h, sáb 8-13h)"}`,
    `Lead: ${leadState.tipo} | Urgência: ${leadState.urgencia} | Msgs: ${msgCount} | Primeiro contato: ${isFirstInteraction ? "SIM" : "NÃO"}`,
    `Emoji: ${emoji ? "SIM (máx 1/msg)" : "NÃO"}`,
    mediaFlags ? `Flags de mídia disponíveis: ${mediaFlags}` : "",
    faltaLinhas.length > 0
      ? `⚠️ Lead quente — dados faltando (colete 1 por vez, não pergunte tudo junto): ${faltaLinhas.join(" → ")}`
      : leadState.tipo === "quente"
        ? `✅ Todos os dados coletados — emita [PASSAGEM].`
        : "",
    dadosColetados,
    priceInfo,
    ``,
    `FORMATO OBRIGATÓRIO — responda SEMPRE em JSON:`,
    `{"mensagens": ["balão 1", "balão 2", "[FOTO_SLUG]", "balão 3"], "delays": [0, 1200, 600, 1500]}`,
    `• Cada balão = 1 frase curta (1-2 linhas)`,
    `• delays em ms (600-2000ms)`,
    `• Flags de mídia: [FOTO_SLUG] ou [VIDEO_SLUG] sozinhos no array`,
    `• Sem "Claro!" "Ótimo!" "Entendido!" "Prezado" — fale como pessoa real`,
    `--- FIM RUNTIME ---`,
  ].filter(Boolean).join("\n");
}

// ── Detecta motivo de interesse do lead (CORREÇÃO 4) ─────────────────────────
function detectarMotivoInteresse(mensagem: string): string | null {
  const n = mensagem.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const temCarro   = /\b(carro|veiculo|auto|caminhonete|moto)\b/.test(n);
  const temFamilia = /\b(famil|filh|espos|filho|filha|crianca|kid)\b/.test(n);
  if (n.includes("os dois") || n.includes("ambos") || (temCarro && temFamilia)) return "os dois";
  if (temCarro)   return "carro";
  if (temFamilia) return "familiar";
  return null;
}

// ── Contexto de sessão injetado no prompt (CORREÇÕES 4, 5, 6) ─────────────────
function buildSessaoContext(
  sessao: Record<string, unknown>,
  collectedData: CollectedData,
): string {
  const lines: string[] = [];

  // Dados já coletados — evita a IA perguntar de novo (CORREÇÃO 4)
  const itens: string[] = [];
  const motivo = sessao.motivoInteresse as string | undefined;
  if (motivo) itens.push(`MOTIVO_DE_INTERESSE: ${motivo} — NÃO perguntar de novo`);
  const cep = (sessao.cep as string | undefined) ?? collectedData.cep;
  if (cep) itens.push(`CEP: ${cep} — NÃO pedir de novo`);
  const endSessao = sessao.enderecoCompleto as string | undefined;
  if (endSessao) itens.push(`ENDEREÇO: ${endSessao} — NÃO pedir de novo`);
  const nomeSessao = (sessao.nomeCliente as string | undefined) ?? collectedData.nome;
  if (nomeSessao) itens.push(`NOME: ${nomeSessao} — NÃO pedir de novo`);
  if (itens.length > 0) {
    lines.push(`\n--- DADOS JÁ COLETADOS NESSA CONVERSA ---`);
    lines.push(...itens);
    lines.push(`--- FIM DOS DADOS COLETADOS ---`);
  }

  // Regra de fechamento — CEP só após confirmação
  lines.push(`\nREGRA DE FECHAMENTO:`);
  lines.push(`NUNCA pedir CEP ou endereço sem antes receber confirmação explícita de compra.`);
  lines.push(`Confirmação explícita = cliente disse "sim", "quero", "fecha", "bora", "pode ser", "fechado".`);
  lines.push(`Sequência correta: 1. CTA de fechamento → 2. Aguardar confirmação → 3. APÓS confirmação → pedir CEP`);

  return lines.join("\n");
}

// ── Prompt base (usado quando o agente não tem prompt customizado) ─────────────
const DEFAULT_SYSTEM_PROMPT = `Prompt do agente não configurado. Acesse /crm/agent para definir o comportamento da IA.`;

export async function processAIResponse(
  conversationId: string,
  userMessage: string,
  agent: AgentConfig,
  incomingMessageId?: string
): Promise<void> {
  try {
    const [recentMessages, conversation, sessaoNacionalDb, sessaoProspeccaoDb] = await Promise.all([
      prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        take: 30,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: { include: { organization: { select: { tipo: true } } } }, lead: true },
      }),
      buscarSessaoNacional(conversationId),
      buscarSessaoProspeccao(conversationId),
    ]);

    if (!conversation) return;
    if (conversation.lead?.status === "ESCALATED") {
      console.log(`[ESCALATION-CHECK] Conv ${conversationId} | lead já está ESCALATED — IA ignorando msg: "${userMessage}"`);
      return;
    }
    if ((conversation as typeof conversation & { humanTakeover?: boolean }).humanTakeover) {
      console.log(`[AI Agent] humanTakeover=true — skipping AI for conv ${conversationId}`);
      return;
    }

    // ── Tipo de organização — decide qual lógica se aplica (VENDAS × PROSPECCAO) ──
    const orgTipoEarly: string =
      (conversation.provider as typeof conversation.provider & { organization?: { tipo?: string } })
        .organization?.tipo ?? "VENDAS";

    // ── CORREÇÃO 2: Área de entrega (só para VENDAS com entrega local) ─────────
    if (orgTipoEarly === "VENDAS" && conversation.foraAreaEntrega) {
      console.log(`[AI Agent] foraAreaEntrega=true — ignorando mensagem para conv ${conversationId}`);
      return;
    }

    if (orgTipoEarly === "VENDAS" && detectForaDeArea(userMessage)) {
      console.log(`[AI Agent] Fora de área detectado para conv ${conversationId} — marcando DB, IA responde`);
      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { foraAreaEntrega: true, etapa: "PERDIDO" },
      }).catch(() => {});
      await prisma.conversationFollowUp.updateMany({
        where: { conversationId, status: "ACTIVE" },
        data: { status: "DONE" },
      }).catch(() => {});
      await cancelFollowUpJobs(conversationId).catch(() => {});
      // Não retorna — IA continua e responde conforme o script configurado
    }

    if (detectDesinteresse(userMessage)) {
      console.log(`[AI Agent] Desinteresse detectado para conv ${conversationId} — marcando DB, IA responde`);
      const orgId = conversation.provider.organizationId;
      // Prospecção usa a coluna DESCARTADO; vendas usa LOST (com fallback)
      const lostColumn = await prisma.kanbanColumn.findFirst({
        where: {
          organizationId: orgId,
          type: orgTipoEarly === "PROSPECCAO" ? "DESCARTADO" : "LOST",
        },
      }).catch(() => null) ?? await prisma.kanbanColumn.findFirst({
        where: { organizationId: orgId, type: "LOST" },
      }).catch(() => null);
      await Promise.all([
        prisma.lead.update({
          where: { id: conversation.leadId! },
          data: { status: "BLOCKED", ...(lostColumn ? { kanbanColumnId: lostColumn.id } : {}) },
        }),
        prisma.conversationFollowUp.updateMany({
          where: { conversationId, status: "ACTIVE" },
          data: { status: "OPT_OUT" },
        }),
      ]).catch(() => {});
      await cancelFollowUpJobs(conversationId).catch(() => {});
      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { etapa: "PERDIDO" },
      }).catch(() => {});
      // Não retorna — IA continua e responde conforme o script configurado
    }

    // Pós-confirmação: silencia mensagens de cortesia (ok, obrigado, etc.)
    // Mensagens substantivas continuam para a IA conforme o script
    if (conversation.etapa === "PEDIDO_CONFIRMADO" && isCourtesyMessage(userMessage)) {
      console.log(`[AI Agent] Pós-confirmação: cortesia ignorada "${userMessage}"`);
      return;
    }

    // ── Contexto ──────────────────────────────────────────────────────────────
    const lead = conversation.lead;
    const orgId = conversation.provider.organizationId;
    const orgTipo: string = orgTipoEarly;

    // Contagem de mensagens trocadas (para detectar etapa da conversa)
    const msgCount = recentMessages.length;
    const isFirstInteraction = recentMessages.filter((m) => m.role === "ASSISTANT").length === 0;

    // ── Primeiro contato — lê (check azul) e mostra typing curto ──────────────
    if (isFirstInteraction && incomingMessageId && conversation.provider.businessPhoneNumberId) {
      await markWhatsAppMessageRead(
        conversation.provider.businessPhoneNumberId,
        incomingMessageId,
        conversation.provider.accessToken ?? undefined,
      ).catch(() => {});
      await sendTypingIndicator(
        conversation.provider.businessPhoneNumberId,
        conversation.customerWhatsappBusinessId,
        3000,
        conversation.provider.accessToken ?? undefined,
      ).catch(() => {});
    }

    // Primeira mensagem do array sempre cita a última mensagem do cliente
    const contextMessageId = incomingMessageId;

    // ── Detectar estado do lead ───────────────────────────────────────────────
    const leadState = detectLeadState(userMessage);

    // ── Guard: intenção de compra bloqueia qualquer escalação ────────────────
    // Se o cliente quer fechar/comprar, NUNCA escalar — vai direto para coleta de dados
    const msgNorm = userMessage.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const INTENCAO_COMPRA = [
      /quero\s+fechar/, /vamos\s+fechar/, /pode\s+fechar/, /quero\s+comprar/,
      /\bfechado\b/, /pode\s+mandar/, /bora\s+fechar/, /me\s+manda\s+/,
      /qual\s+(o\s+)?valor/, /quanto\s+custa/, /faz\s+entrega/, /tem\s+estoque/,
      /me\s+passa\s+o\s+pix/, /vou\s+querer/, /to\s+dentro/, /to\s+fechando/,
    ];
    const temIntencaoCompra = INTENCAO_COMPRA.some((re) => re.test(msgNorm));
    if (temIntencaoCompra) {
      console.log(`[ESCALATION-TRACE] v2 | COMPRA — escalação BLOQUEADA por intenção de compra: "${userMessage}"`);
    }

    // ── Hard escalation check (antes do LLM, garante escalada mesmo que a IA erre) ──
    console.log(`[ESCALATION-TRACE] v2 | Conv ${conversationId} | Msgs no histórico: ${msgCount} | Msg recebida: "${userMessage}" | Lead status: ${lead?.status ?? "null"}`);
    const hardEscalation = !temIntencaoCompra
      ? detectHardEscalation(
          userMessage,
          recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content })),
        )
      : { shouldEscalate: false, reason: "" };
    console.log(`[ESCALATION-TRACE] resultado detectHardEscalation: shouldEscalate=${hardEscalation.shouldEscalate} | reason="${hardEscalation.reason}"`);
    if (hardEscalation.shouldEscalate && lead?.status !== "ESCALATED") {
      const to = conversation.customerWhatsappBusinessId;
      const token = conversation.provider.accessToken ?? undefined;
      console.log(`[ESCALATION] Regra: "${hardEscalation.reason}" | Cliente: ${to} | Msg: "${userMessage}"`);

      // ── Log de escalação: salva regra disparada + últimas 5 mensagens ────────
      const last5 = recentMessages.slice(0, 5).reverse()
        .map((m) => `[${m.role}] ${m.content.substring(0, 120)}`)
        .join("\n");
      await prisma.ownerNotification.create({
        data: {
          type: "ESCALATION",
          title: `🔔 Escalada | ${lead?.profileName ?? to} | Regra: ${hardEscalation.reason}`,
          body: `📱 Cliente: ${to}\n⚡ Regra disparada: ${hardEscalation.reason}\n💬 Mensagem que disparou: "${userMessage}"\n\n📋 Últimas 5 mensagens:\n${last5}`,
          organizationId: orgId,
          leadId: conversation.leadId,
          conversationId,
        },
      }).catch(() => {});

      await handleEscalation(conversation.leadId, conversationId, hardEscalation.reason);
      notificarEscalacao({
        nomeCliente:    lead?.profileName ?? to,
        motivo:         hardEscalation.reason,
        conversationId,
      }).catch(() => {});
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "deixa eu chamar o Pedro aqui, ele vai te ajudar melhor nessa 👊",
        token,
      ).catch(() => {});
      return;
    }

    // ── Carregar AiConfig (completo — inclui campos do Command Center) ────────
    const aiConfig = await prisma.aiConfig.findUnique({ where: { organizationId: orgId } }).catch(() => null);

    // ── ProductSourcingService — detecta produto na msg e busca dados reais ───
    const detectedProducts = await productSourcingService
      .detectAndFetch(userMessage, orgId)
      .catch(() => []);
    if (detectedProducts.length > 0) {
      console.log(`[AI Agent] ProductSourcing detectou ${detectedProducts.length} produto(s): ${detectedProducts.map(p => p.name).join(", ")}`);
    }

    // ── Produtos ativos — fonte única: buscarProdutosAtivos() ────────────────
    // Inclui especificacoes para IA usar ao responder perguntas técnicas
    // Filtra apenas produtos GPS (único produto vendido neste canal)
    const produtosContexto = (await buscarProdutosAtivos(orgId)).filter(
      (p) => /gps/i.test(p.nome) || /gps/i.test(p.slug)
    );
    // Mapeamento para ProductRef (compatibilidade com promptCompiler)
    const activeProducts = produtosContexto.map((p) => ({
      id: p.id,
      name: p.nome,
      imageUrl: p.temFoto ? "has_media" : null,
      videoUrl: p.temVideo ? "has_media" : null,
    }));

    // ── CORREÇÃO 4: Envio forçado de mídia no primeiro contato ───────────────
    // Detecta produto pela mensagem do usuário e envia foto+vídeo IMEDIATAMENTE,
    // antes da IA responder. Não depende de flag — sempre funciona.
    const appUrlEarly = getBaseUrl();
    const toPublicUrlEarly = (url: string, productId: string, idx: number, isVideo = false): string => {
      if (!url) return "";
      if (url.startsWith("data:")) {
        if (!appUrlEarly) return "";
        return isVideo
          ? `${appUrlEarly}/api/media/product/${productId}?type=video`
          : `${appUrlEarly}/api/media/product/${productId}?idx=${idx}`;
      }
      return url;
    };
    const msgLower = userMessage.toLowerCase();
    if (isFirstInteraction) {
      // Reutiliza produtosContexto — sem query extra ao banco
      const productsWithMediaEarly = await prisma.product.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
      });
      for (const prod of productsWithMediaEarly) {
        const nm = prod.name.toLowerCase();
        const words = nm.split(/\s+/).filter((w) => w.length >= 3);
        const matchesByName = msgLower.includes(nm);
        const matchesByWords = words.some((w) => msgLower.includes(w));
        if (!matchesByName && !matchesByWords) continue;

        console.log(`[AI Agent] FORCED first-contact media for "${prod.name}" | appUrlEarly="${appUrlEarly}"`);
        const imgs: string[] = (Array.isArray(prod.imageUrls) && prod.imageUrls.length > 0)
          ? prod.imageUrls as string[]
          : prod.imageUrl ? [prod.imageUrl] : [];
        console.log(`[AI Agent] ${imgs.length} imagens encontradas para "${prod.name}" | videoUrl=${!!prod.videoUrl}`);
        for (let i = 0; i < imgs.length; i++) {
          const imgUrl = toPublicUrlEarly(imgs[i], prod.id, i);
          console.log(`[AI Agent] imgUrl[${i}]: "${imgUrl.substring(0, 80)}"`);
          if (!imgUrl) { console.error(`[AI Agent] imgUrl[${i}] vazio — pulando`); continue; }
          await new Promise((r) => setTimeout(r, 500));
          try {
            await sendWhatsAppImage(
              conversation.provider.businessPhoneNumberId,
              conversation.customerWhatsappBusinessId,
              imgUrl, prod.name,
              conversation.provider.accessToken ?? undefined,
            );
            await prisma.whatsappMessage.create({
              data: { content: `[Imagem] ${prod.name}`, type: "IMAGE", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
            }).catch(() => {});
            console.log(`[AI Agent] ✅ Forced image ${i + 1}/${imgs.length} enviada`);
          } catch (e) { console.error(`[AI Agent] ❌ Forced image failed idx=${i}:`, e); }
        }
        if (prod.videoUrl) {
          const vidUrl = toPublicUrlEarly(prod.videoUrl, prod.id, 0, true);
          if (vidUrl) {
            await new Promise((r) => setTimeout(r, 800));
            try {
              await sendWhatsAppVideo(
                conversation.provider.businessPhoneNumberId,
                conversation.customerWhatsappBusinessId,
                vidUrl, prod.name,
                conversation.provider.accessToken ?? undefined,
              );
              await prisma.whatsappMessage.create({
                data: { content: `[Vídeo] ${prod.name}`, type: "VIDEO", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
              }).catch(() => {});
              console.log(`[AI Agent] ✅ Forced video enviado`);
            } catch (e) { console.error(`[AI Agent] ❌ Forced video failed:`, e); }
          }
        }
        break; // envia apenas o primeiro produto identificado
      }
    }

    // Catálogo dinâmico injetado no prompt — inclui especificacoes para a IA usar
    const productSection = produtosContexto.length > 0
      ? "\n\nCATÁLOGO:\n" + formatarProdutosParaContexto(produtosContexto)
      : "";

    // ── Contexto do lead ──────────────────────────────────────────────────────
    const leadContext = lead ? [
      `\n--- LEAD ---`,
      `Nome: ${lead.profileName ?? "desconhecido"}`,
      `Telefone: ${lead.phoneNumber}`,
      `Status: ${lead.status}`,
      `--- FIM ---`,
    ].join("\n") : "";

    // ── Montar prompt final ───────────────────────────────────────────────────
    const basePrompt = agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    // Extrai dados já coletados para evitar perguntar de novo
    const collectedData = extractCollectedData(
      recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content }))
    );

    // ── Sessão de prospecção B2B ──────────────────────────────────────────────
    const sessaoProspeccao: SessaoProspeccao = { ...sessaoProspeccaoDb };

    // Atualiza campos de prospecção extraídos da mensagem
    if (orgTipo === "PROSPECCAO") {
      // Extrai nome da empresa se mencionado
      if (!sessaoProspeccao.empresaNome) {
        const empresaMatch = userMessage.match(/(?:empresa|negócio|negocio|firma|loja|escritório|escritorio)[:\s]+([A-Z][^,.\n]{2,40})/i);
        if (empresaMatch) {
          const nome = empresaMatch[1].trim();
          void atualizarSessaoProspeccao(conversationId, { empresaNome: nome }).catch(() => {});
          sessaoProspeccao.empresaNome = nome;
        }
      }
    }

    // ── Sessão nacional — mutable copy para atualizar localmente (CORREÇÃO 4) ──
    const sessaoNacional: Record<string, unknown> = { ...sessaoNacionalDb };
    // Detectar motivo de interesse na mensagem atual
    if (!sessaoNacional.motivoInteresse) {
      const motivo = detectarMotivoInteresse(userMessage);
      if (motivo) {
        void atualizarSessaoNacional(conversationId, { motivoInteresse: motivo }).catch(() => {});
        sessaoNacional.motivoInteresse = motivo;
      }
    }
    // Detectar CEP na mensagem atual
    if (!sessaoNacional.cep) {
      const cepMatch = userMessage.match(/\b(\d{5})[-\s]?(\d{3})\b/);
      if (cepMatch) {
        const cepFormatted = `${cepMatch[1]}-${cepMatch[2]}`;
        void atualizarSessaoNacional(conversationId, { cep: cepFormatted }).catch(() => {});
        sessaoNacional.cep = cepFormatted;
      }
    }
    // Sincronizar endereço e nome com sessaoNacional (para o [AGUARDANDO_PAGAMENTO])
    if (!sessaoNacional.enderecoCompleto && collectedData.endereco) {
      void atualizarSessaoNacional(conversationId, { enderecoCompleto: collectedData.endereco }).catch(() => {});
      sessaoNacional.enderecoCompleto = collectedData.endereco;
    }
    if (!sessaoNacional.nomeCliente && collectedData.nome) {
      void atualizarSessaoNacional(conversationId, { nomeCliente: collectedData.nome }).catch(() => {});
      sessaoNacional.nomeCliente = collectedData.nome;
    }

    // ── CORREÇÃO 5: Passagem automática por código quando todos os dados estão coletados ──
    const temEndereco  = !!(collectedData.endereco || collectedData.localizacao);
    const dadosCompletos = temEndereco && !!collectedData.horario && !!collectedData.pagamento && !!collectedData.nome;
    const passagemJaFeita = recentMessages.some((m) => /\[PASSAGEM\]/.test(m.content));
    if (dadosCompletos && !passagemJaFeita) {
      console.log(`[AI Agent] PASSAGEM AUTOMÁTICA ativada por código — todos os 4 dados coletados`);
      const produtoNome = produtosContexto[0]?.nome ?? "produto";
      const clientName  = lead?.profileName ?? "Cliente";
      notificarPassagem({
        nomeCliente:    clientName,
        produto:        produtoNome,
        endereco:       collectedData.endereco ?? collectedData.localizacao ?? "não informado",
        pagamento:      collectedData.pagamento ?? "não informado",
        conversationId,
      }).catch(() => {});
      const ownerNumber = config.ownerWhatsapp;
      const to          = conversation.customerWhatsappBusinessId;
      const token       = conversation.provider.accessToken ?? undefined;

      // Últimas 3 mensagens do cliente
      const last3client = recentMessages
        .filter((m) => m.role === "USER")
        .slice(0, 3)
        .reverse()
        .map((m) => `"${m.content.substring(0, 80)}"`)
        .join("\n");

      const handoffMsg =
        `*🔔 PEDIDO NOVO — ${config.businessName.toUpperCase()}*\n\n` +
        `📦 *Produto:* ${produtoNome}\n` +
        `👤 *Nome:* ${collectedData.nome}\n` +
        `🏠 *Endereço:* ${collectedData.endereco ?? collectedData.localizacao}\n` +
        `🗺️ *Localização:* ${collectedData.localizacao ?? "não enviada"}\n` +
        `⏰ *Receber até:* ${collectedData.horario}\n` +
        `💳 *Pagamento:* ${collectedData.pagamento}\n` +
        `📱 *WhatsApp cliente:* ${to}\n\n` +
        `💬 *Últimas mensagens do cliente:*\n${last3client}\n\n` +
        `_Organizar entrega e encaminhar motoboy._`;

      // Tenta enviar — retry 30s → 2min se falhar
      const enviarPassagem = async (tentativa = 1) => {
        try {
          await sendWhatsAppMessage(conversation.provider.businessPhoneNumberId, ownerNumber, handoffMsg, token);
          await prisma.ownerNotification.create({
            data: { type: "ORDER", title: `🎉 Pedido: ${clientName}`, body: handoffMsg, organizationId: orgId, leadId: conversation.leadId, conversationId },
          }).catch(() => {});
          await prisma.lead.update({ where: { id: conversation.leadId! }, data: { status: "CLOSED" } }).catch(() => {});
          await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { resumoEnviado: true } }).catch(() => {});
          console.log(`[AI Agent] PASSAGEM enviada com sucesso (tentativa ${tentativa})`);
        } catch (e) {
          console.error(`[AI Agent] PASSAGEM falhou tentativa ${tentativa}:`, e);
          if (tentativa === 1) {
            setTimeout(() => enviarPassagem(2), 30_000);
          } else if (tentativa === 2) {
            setTimeout(() => enviarPassagem(3), 120_000);
          }
        }
      };
      await enviarPassagem();

      // Confirma ao cliente
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "pedido confirmado! 🎉", token,
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "nossa equipe vai entrar em contato pra confirmar o horário certinho", token,
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "qualquer dúvida é só chamar 👊", token,
      ).catch(() => {});

      // Salva mensagens e marca pedido confirmado
      await prisma.whatsappMessage.create({ data: { content: "pedido confirmado! 🎉", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
      await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), etapa: "PEDIDO_CONFIRMADO" } }).catch(() => {});
      await prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "DONE" } }).catch(() => {});
      await cancelFollowUpJobs(conversationId).catch(() => {});
      return; // não chamar LLM — pedido já encerrado
    }

    // ── Sandbox mode (após passagem — passagem sempre dispara, sandbox só bloqueia IA) ──
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? config.ownerWhatsapp;
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      if (customerNum !== sandboxNumber.replace(/\D/g, "")) {
        console.log(`[AI Agent] 🔒 SANDBOX MODE — IA bloqueada para ${customerNum} (só atende ${sandboxNumber})`);
        return;
      }
    }

    // ── DecisionService: decide a ação e loga ─────────────────────────────────
    const decisionCtx = {
      conversationId,
      userMessage,
      messageCount: msgCount,
      leadStatus: lead?.status ?? "OPEN",
      etapa: conversation.etapa,
      humanTakeover: !!(conversation as typeof conversation & { humanTakeover?: boolean }).humanTakeover,
      foraAreaEntrega: conversation.foraAreaEntrega,
      isOptOut: /\[OPT_OUT\]/i.test(recentMessages.map((m) => m.content).join(" ")),
      hardEscalation: !!hardEscalation.shouldEscalate,
      hasIntentoBuy: temIntencaoCompra,
      isFirstInteraction,
      allDataCollected: dadosCompletos,
      isDesinteresse: detectDesinteresse(userMessage),
    };
    const decision = decisionService.decide(decisionCtx);
    void decisionService.log(decisionCtx, decision); // fire-and-forget
    console.log(`[DecisionService] Conv ${conversationId} → ${decision.action}: ${decision.reason}`);

    if (decision.action === "WAIT" || decision.action === "CLOSE") {
      console.log(`[DecisionService] ${decision.action} — IA silenciada para conv ${conversationId}. Razão: ${decision.reason}`);
      await prisma.ownerNotification.create({
        data: {
          type: "INFO",
          title: `IA silenciada (${decision.action})`,
          body: `Conv: ${conversationId}\nCliente: ${conversation.customerWhatsappBusinessId}\nRazão: ${decision.reason}`,
          organizationId: conversation.provider.organizationId,
          conversationId,
        },
      }).catch(() => {});
      return;
    }

    // ── PromptCompiler: monta systemPrompt em 6 camadas ──────────────────────
    const now_sp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

    // Slots de agenda para orgs de prospecção (carregado de forma lazy)
    const slotsDisponiveis = orgTipo === "PROSPECCAO"
      ? await buscarSlotsDisponiveis(5).catch(() => [] as Array<{ label: string; inicio: Date; fim: Date }>)
      : [];

    // Build full aiConfig layer including Command Center fields
    const aiConfigLayer = aiConfig ? {
      usarEmoji:            aiConfig.usarEmoji,
      usarReticencias:      aiConfig.usarReticencias,
      nivelVenda:           aiConfig.nivelVenda,
      tomDeVoz:             aiConfig.tomDeVoz,
      arquetipoIA:          aiConfig.arquetipoIA,
      objetivoVenda:        aiConfig.objetivoVenda,
      nivelUrgencia:        aiConfig.nivelUrgencia,
      matrizObjecoes:       Array.isArray(aiConfig.matrizObjecoes) ? (aiConfig.matrizObjecoes as unknown as import("@/lib/ai/prompt-compiler").ObjecaoEntry[]) : [],
      restricoes:           Array.isArray(aiConfig.restricoes)     ? (aiConfig.restricoes as string[]) : [],
      followUpIntervalos:   Array.isArray(aiConfig.followUpIntervalos) ? (aiConfig.followUpIntervalos as number[]) : [4,24,48,72],
      followUpMaxTentativas: aiConfig.followUpMaxTentativas,
    } : null;

    const compiled = promptCompiler.compile({
      basePersonaPrompt: basePrompt,
      aiConfig: aiConfigLayer,
      activeProducts,
      businessHours: { hour: now_sp.getHours(), dayOfWeek: now_sp.getDay() },
      collectedData,
      recentMessages: recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content })),
      leadState,
      messageCount: msgCount,
      isFirstInteraction,
      etapa: conversation.etapa,
      detectedProducts, // Camada 5 — catálogo real (ignorada em PROSPECCAO)
      organizationTipo: orgTipo,
      slotsDisponiveis,
      sessaoProspeccao,
    });
    const flagsRuntimeSection = "\n\n[AUDIO:texto] — envia mensagem de voz TTS. Use para mensagens pessoais ou quando o cliente preferir áudio.";
    const sessaoContext = buildSessaoContext(sessaoNacional, collectedData);
    const systemPromptFinal = compiled.systemPrompt + productSection + leadContext + flagsRuntimeSection + sessaoContext;

    // ── Histórico de chat ─────────────────────────────────────────────────────
    const chatHistory = recentMessages
      .slice()
      .reverse()
      .slice(0, -1)
      .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

    // ── Chamada ao LLM com retry exponencial ────────────────────────────────
    let rawResponse: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      rawResponse = await callLLM(systemPromptFinal, chatHistory, userMessage, agent.aiProvider ?? undefined, agent.aiModel ?? undefined);
      if (rawResponse) break;
      if (attempt < 3) {
        console.warn(`[AI Agent] LLM retornou null — tentativa ${attempt}/3 — aguardando ${attempt * 2}s`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    if (!rawResponse) {
      console.error(`[AI Agent] LLM falhou 3 tentativas para conv ${conversationId} — notificando Pedro`);
      await notificarErroCritico(
        `IA não respondeu após 3 tentativas.\nCliente: ${conversation.customerWhatsappBusinessId}\nConv: ${conversationId}`,
        conversation.provider.businessPhoneNumberId,
        conversation.provider.accessToken ?? undefined,
      ).catch(() => {});
      return;
    }

    // ── Filtro anti-alucinação de dados de pagamento ──────────────────────────
    // Se a IA escreveu chave Pix/link de pagamento sem emitir [PEDIDO_NACIONAL] ou [CHECKOUT], é alucinação
    if (!rawResponse.includes("[PEDIDO_NACIONAL]") && !rawResponse.includes("[CHECKOUT]")) {
      const pixHallucination = /chave\s*pix\s*[:\-=]\s*\S+|código\s*(pix|de\s+pagamento)\s*[:\-=]\s*\S+|pix\s*[:\-=]\s*[\w@.]{5,}/i;
      if (pixHallucination.test(rawResponse)) {
        console.error(`[AI Agent] 🚨 ALUCINAÇÃO DE PIX detectada — resposta bloqueada | conv ${conversationId} | raw="${rawResponse.substring(0, 200)}"`);
        rawResponse = JSON.stringify({
          mensagens: ["deixa eu verificar o pedido aqui... 🔄", "me aguarda um segundo!"],
          delays: [0, 1500],
        });
      }
    }


    // ── Parse de multi-mensagens ──────────────────────────────────────────────
    console.log(`[AI Agent] Raw LLM response: ${rawResponse.substring(0, 300)}`);
    const { mensagens: rawMsgs, delays } = parseAIResponse(rawResponse);
    const combinedRaw = [rawResponse, ...rawMsgs].join("\n");
    console.log(`[AI Agent] Parsed ${rawMsgs.length} messages. combinedRaw length: ${combinedRaw.length}`);
    const mediaFlagRe = /\[(FOTO|VIDEO)_[A-Z0-9_]+\]/gi;

    // ── Limpar flags das mensagens que vão pro cliente ────────────────────────
    const mensagens = rawMsgs.map((m) =>
      m.replace(/^\[ESCALAR\]\s*/i, "")
        .replace(/\[PASSAGEM\]\s*\{[\s\S]*?\}/gi, "")
        .replace(/\[OPT_OUT\]/gi, "")
        .replace(/\[PEDIDO_NACIONAL\]/gi, "")
        .replace(/\[CHECKOUT\]/gi, "")
        .replace(/\[AGUARDANDO_PAGAMENTO\]/gi, "")
        .replace(/\[REUNIAO_AGENDADA\]/gi, "")
        .replace(/\[QUALIFICADO\]/gi, "")
        .replace(mediaFlagRe, "")
        .trim()
    ).filter(Boolean);

    // Só retorna se não há nem mensagens de texto nem flags de mídia a processar
    const hasMediaFlag = /\[(FOTO|VIDEO)_[A-Z0-9_]+\]/i.test(combinedRaw);
    if (mensagens.length === 0 && !hasMediaFlag) {
      console.log(`[AI Agent] Resposta vazia e sem flags de mídia — descartando para conv ${conversationId}`);
      return;
    }
    console.log(`[AI Agent] mensagens=${mensagens.length} | hasMediaFlag=${hasMediaFlag} | combinedRaw length=${combinedRaw.length}`);

    const provider = conversation.provider;
    const to = conversation.customerWhatsappBusinessId;
    const token = provider.accessToken ?? undefined;
    const now = new Date();

    // Captura de Meet link para envio ao cliente após o loop de mensagens
    let reuniaoMeetLink: string | null = null;
    let reuniaoDataLabel: string | null = null;

    // ── [OPT_OUT] ─────────────────────────────────────────────────────────────
    if (/\[OPT_OUT\]/i.test(combinedRaw)) {
      await Promise.all([
        prisma.lead.update({ where: { id: conversation.leadId }, data: { status: "BLOCKED" } }),
        prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "OPT_OUT" } }),
      ]);
      await cancelFollowUpJobs(conversationId).catch(() => {});
      if (orgTipo === "PROSPECCAO" && conversation.leadId) {
        await moverLeadPorTipo(conversation.leadId, orgId, "DESCARTADO", "Opt-out solicitado pelo contato", "LOST");
      }
    }

    // ── [QUALIFICADO] — lead qualificado pela IA → Proposta e Negociação ──────
    if (/\[QUALIFICADO\]/i.test(combinedRaw) && orgTipo === "PROSPECCAO" && conversation.leadId) {
      console.log(`[AI Agent] 🎯 [QUALIFICADO] | conv ${conversationId}`);
      await moverLeadPorTipo(conversation.leadId, orgId, "PROPOSTA", "Lead qualificado pela IA");
      const leadComProspect = await prisma.lead.findUnique({
        where: { id: conversation.leadId },
        select: { prospectLeadId: true },
      }).catch(() => null);
      if (leadComProspect?.prospectLeadId) {
        await prisma.prospectLead.update({
          where: { id: leadComProspect.prospectLeadId },
          data: { status: "QUALIFICADO" },
        }).catch(() => {});
      }
    }

    // ── [PASSAGEM] ────────────────────────────────────────────────────────────
    const passagemMatch = combinedRaw.match(/\[PASSAGEM\]\s*(\{[\s\S]*?\})/i);
    if (passagemMatch) {
      try {
        const orderData = JSON.parse(passagemMatch[1]);
        const clientName = lead?.profileName ?? "Cliente";
        const produtoStr = orderData.produto ?? orderData.produtos
          ? (Array.isArray(orderData.produtos)
              ? orderData.produtos.map((p: { nome: string; qtd?: number }) => `${p.nome} x${p.qtd ?? 1}`).join(", ")
              : String(orderData.produtos))
          : "N/A";
        const handoffMsg =
          `*🔔 PEDIDO NOVO — ${config.businessName.toUpperCase()}*\n\n` +
          `👤 *Cliente:* ${clientName}\n` +
          `📱 *WhatsApp:* ${to}\n` +
          `📦 *Produto:* ${produtoStr}\n` +
          `📍 *Localização:* ${orderData.localizacao ?? "não enviada"}\n` +
          `🏠 *Endereço:* ${orderData.endereco ?? "?"}\n` +
          `💳 *Pagamento:* ${orderData.pagamento ?? "?"}\n` +
          `🕐 *Recebe até:* ${orderData.horario ?? "?"}\n` +
          `🙍 *Nome recebedor:* ${orderData.nome ?? clientName}\n\n` +
          `_Organize a entrega e encaminhe o motoboy._`;
        const ownerNumber = config.ownerWhatsapp;
        await sendWhatsAppMessage(provider.businessPhoneNumberId, ownerNumber, handoffMsg, token)
          .catch((e) => console.error("[AI Agent] Passagem send failed:", e));
        notificarPassagem({
          nomeCliente:    clientName,
          produto:        produtoStr,
          endereco:       orderData.endereco ?? orderData.localizacao ?? "não informado",
          pagamento:      orderData.pagamento ?? "não informado",
          conversationId,
        }).catch(() => {});
        await prisma.ownerNotification.create({
          data: { type: "ORDER", title: `Novo pedido: ${clientName}`, body: handoffMsg, organizationId: orgId, leadId: conversation.leadId, conversationId },
        }).catch(() => {});
        // Marca conversa como pedido confirmado e cancela follow-ups
        await prisma.whatsappConversation.update({
          where: { id: conversationId },
          data: { etapa: "PEDIDO_CONFIRMADO" },
        }).catch(() => {});
        await prisma.conversationFollowUp.updateMany({
          where: { conversationId, status: "ACTIVE" },
          data: { status: "DONE" },
        }).catch(() => {});
        await cancelFollowUpJobs(conversationId).catch(() => {});
      } catch (e) { console.error("[AI Agent] PASSAGEM parse error:", e); }
    }

    // ── [ESCALAR] soft trigger — DESATIVADO temporariamente ─────────────────
    // A IA não pode mais escalar por conta própria. Escalação só via Camada 1 (código).
    // Quando [ESCALAR] aparecer na resposta da IA, logamos mas NÃO escalamos.
    if (/\[ESCALAR\]/i.test(combinedRaw)) {
      console.log(`[ESCALATION-BLOCKED] Camada 2 DESATIVADA — IA tentou emitir [ESCALAR] para conv ${conversationId} | msg do cliente: "${userMessage}" | Resp da IA: ${rawResponse.substring(0, 200)}`);
      await prisma.ownerNotification.create({
        data: {
          type: "ESCALATION",
          title: `⚠️ IA tentou escalar (bloqueado) | ${lead?.profileName ?? to}`,
          body: `A IA emitiu [ESCALAR] mas foi bloqueada pelo código.\nCliente: ${to}\nResposta da IA:\n${rawResponse.substring(0, 400)}`,
          organizationId: orgId,
          leadId: conversation.leadId,
          conversationId,
        },
      }).catch(() => {});
      // NÃO chama handleEscalation — IA não pode escalar sozinha agora
    }

    // ── [AGUARDANDO_PAGAMENTO] — cria checkout, envia link, pausa IA ──────────
    if (/\[AGUARDANDO_PAGAMENTO\]/i.test(combinedRaw)) {
      console.log(`[AI Agent] 🔔 [AGUARDANDO_PAGAMENTO] | conv ${conversationId} | cliente ${to}`);

      // Mensagem imediata enquanto cria o checkout
      await sendWhatsAppMessage(provider.businessPhoneNumberId, to, "um segundo! estou gerando seu link de pagamento agora 🔗", token).catch(() => {});
      await prisma.whatsappMessage.create({ data: { content: "um segundo! estou gerando seu link de pagamento agora 🔗", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));

      // Criar checkout via API
      let checkoutUrl: string | null = null;
      try {
        const baseUrl = getBaseUrl();
        const checkoutRes = await fetch(`${baseUrl}/api/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telefoneCliente: to,
            conversationId,
            nomeCliente: (sessaoNacional.nomeCliente as string | undefined) ?? lead?.profileName ?? undefined,
            produto: produtosContexto[0]?.nome ?? undefined,
            valorProduto: produtosContexto[0]?.preco ?? undefined,
            cep: (sessaoNacional.cep as string | undefined) ?? collectedData.cep ?? undefined,
            enderecoCompleto: (sessaoNacional.enderecoCompleto as string | undefined) ?? collectedData.endereco ?? undefined,
          }),
        });
        if (checkoutRes.ok) {
          const checkoutData = await checkoutRes.json() as { id: string; url: string };
          checkoutUrl = checkoutData.url;
          console.log(`[PAGAMENTO] Checkout criado: ${checkoutData.id} | url: ${checkoutUrl}`);
        }
      } catch (err) {
        console.error(`[PAGAMENTO] Erro ao criar checkout:`, err);
      }

      // Enviar link para o cliente (4 mensagens)
      if (checkoutUrl) {
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, "aqui está seu link de pagamento 👇", token).catch(() => {});
        await prisma.whatsappMessage.create({ data: { content: "aqui está seu link de pagamento 👇", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, checkoutUrl, token).catch(() => {});
        await prisma.whatsappMessage.create({ data: { content: checkoutUrl, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, "pode escolher pagar por Pix, cartão parcelado ou boleto 😊", token).catch(() => {});
        await prisma.whatsappMessage.create({ data: { content: "pode escolher pagar por Pix, cartão parcelado ou boleto 😊", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, "qualquer dúvida pode chamar aqui 👊", token).catch(() => {});
        await prisma.whatsappMessage.create({ data: { content: "qualquer dúvida pode chamar aqui 👊", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
      } else {
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, "já te mando aqui ⏳", token).catch(() => {});
        await prisma.whatsappMessage.create({ data: { content: "já te mando aqui ⏳", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
      }

      // Notificar Pedro
      const notificacaoPag =
        `🛒 *CLIENTE NO CHECKOUT*\n\n` +
        `👤 Nome: ${(sessaoNacional.nomeCliente as string | undefined) ?? lead?.profileName ?? "Não informado"}\n` +
        `📱 WhatsApp: ${to}\n` +
        `📦 Produto: ${produtosContexto[0]?.nome ?? "Não informado"}\n` +
        `💵 Valor: R$ ${produtosContexto[0]?.preco?.toFixed(2).replace(".", ",") ?? "—"}\n` +
        `📍 CEP: ${(sessaoNacional.cep as string | undefined) ?? collectedData.cep ?? "Não informado"}\n` +
        `📮 Endereço: ${(sessaoNacional.enderecoCompleto as string | undefined) ?? collectedData.endereco ?? "Não informado"}\n` +
        (checkoutUrl ? `\n🔗 Link checkout: ${checkoutUrl}\n` : `\n⚡ Envie link manualmente para: wa.me/${to}\n`) +
        `\n✅ Link enviado ao cliente — aguardando pagamento`;
      await sendWhatsAppMessage(provider.businessPhoneNumberId, config.ownerWhatsapp, notificacaoPag, token).catch(() => {});

      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { humanTakeover: true, etapa: "AGUARDANDO_PAGAMENTO_MANUAL", lastMessageAt: new Date() },
      }).catch(() => {});
      await cancelFollowUpJobs(conversationId).catch(() => {});
      console.log(`[PAGAMENTO] Checkout enviado + Pedro notificado — IA pausada para conv ${conversationId}`);
      return;
    }

    // ── [REUNIAO_AGENDADA] — cria evento no Google Calendar, notifica Pedro ───
    if (/\[REUNIAO_AGENDADA\]/i.test(combinedRaw) && orgTipo === "PROSPECCAO") {
      console.log(`[AI Agent] 🔔 [REUNIAO_AGENDADA] | conv ${conversationId} | prospect ${to}`);

      try {
        // Extrai data/hora preferida da sessão de prospecção
        const dataHoraStr = sessaoProspeccao.dataHoraPreferida;
        const dataHoraInicio = dataHoraStr ? new Date(dataHoraStr) : (() => {
          // Fallback: próximo dia útil às 10h
          const d = new Date();
          d.setDate(d.getDate() + 1);
          if (d.getDay() === 0) d.setDate(d.getDate() + 1);
          if (d.getDay() === 6) d.setDate(d.getDate() + 2);
          d.setHours(10, 0, 0, 0);
          return d;
        })();

        const nomeNegocio = sessaoProspeccao.empresaNome ?? lead?.profileName ?? to;

        // Verifica disponibilidade antes de criar
        const disponivel = await verificarDisponibilidade(dataHoraInicio, 30).catch(() => true);
        if (!disponivel) {
          console.warn(`[REUNIAO_AGENDADA] Horário ocupado — aguardando reagendamento | conv ${conversationId}`);
          await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
            "esse horário ficou ocupado agora 😅 me diz outra opção que eu confirmo!", token).catch(() => {});
          await prisma.whatsappMessage.create({
            data: { content: "esse horário ficou ocupado agora 😅 me diz outra opção que eu confirmo!", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
          }).catch(() => {});
          return;
        }

        const evento = await criarEventoReuniao({
          nomeNegocio,
          telefone: to,
          dataHoraInicio,
          duracaoMinutos: 30,
        }).catch(() => null);

        if (evento) {
          // Salva na sessão e no banco
          void atualizarSessaoProspeccao(conversationId, { sinalOportunidade: "REUNIAO_AGENDADA" }).catch(() => {});

          // Busca ou cria ProspectLead
          const leadProspectId = (lead as typeof lead & { prospectLeadId?: string | null })?.prospectLeadId;
          const existingProspect = leadProspectId
            ? await prisma.prospectLead.findUnique({ where: { id: leadProspectId } }).catch(() => null)
            : null;

          if (existingProspect) {
            await prisma.prospectLead.update({
              where: { id: existingProspect.id },
              data: {
                status: "REUNIAO_AGENDADA",
                dataHoraReuniao: dataHoraInicio,
                googleCalendarEventId: evento.eventId,
                googleMeetLink: evento.meetLink ?? null,
              },
            }).catch(() => {});
          } else {
            const novoProspect = await prisma.prospectLead.create({
              data: {
                organizationId: orgId,
                status: "REUNIAO_AGENDADA",
                tipoNegocio: sessaoProspeccao.tipoNegocio ?? null,
                urgencia: sessaoProspeccao.urgencia ?? null,
                sinalOportunidade: sessaoProspeccao.sinalOportunidade ?? null,
                dataHoraReuniao: dataHoraInicio,
                googleCalendarEventId: evento.eventId,
                googleMeetLink: evento.meetLink ?? null,
              },
            }).catch(() => null);

            if (novoProspect && lead) {
              await prisma.lead.update({
                where: { id: lead.id },
                data: { prospectLeadId: novoProspect.id },
              }).catch(() => {});
            }
          }

          // Funil: move o lead para "Reunião Agendada" e cria o evento local
          // (a aba Calendário lê CalendarEvent — sem isso a reunião ficaria invisível)
          if (lead) {
            await moverLeadPorTipo(lead.id, orgId, "REUNIAO_AGENDADA", "Reunião agendada pela IA");
          }
          await prisma.calendarEvent.create({
            data: {
              title: `Diagnóstico Nexo — ${nomeNegocio}`,
              description: `Reunião agendada pela IA via WhatsApp.\nContato: ${to}` +
                (sessaoProspeccao.tipoNegocio ? `\nTipo de negócio: ${sessaoProspeccao.tipoNegocio}` : ""),
              startTime: dataHoraInicio,
              endTime: new Date(dataHoraInicio.getTime() + 30 * 60 * 1000),
              provider: "GOOGLE",
              externalEventId: evento.eventId,
              googleMeetLink: evento.meetLink ?? null,
              organizationId: orgId,
              leadId: lead?.id ?? null,
              whatsappProviderConfigId: provider.id,
            },
          }).catch((e) => console.error("[REUNIAO_AGENDADA] Falha ao criar CalendarEvent local:", e));

          // Captura Meet link para enviar ao cliente após o loop de mensagens
          if (evento.meetLink) {
            reuniaoMeetLink = evento.meetLink;
          }

          // Notifica o gestor
          const dataLabel = dataHoraInicio.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
          reuniaoDataLabel = dataLabel;

          const notifMsg =
            `📅 *REUNIÃO AGENDADA — NEXO*\n\n` +
            `🏢 Empresa: ${nomeNegocio}\n` +
            `📱 WhatsApp: ${to}\n` +
            `🗓️ Data/hora: ${dataLabel}\n` +
            (sessaoProspeccao.tipoNegocio ? `💼 Tipo de negócio: ${sessaoProspeccao.tipoNegocio}\n` : "") +
            (evento.meetLink ? `🔗 Google Meet: ${evento.meetLink}\n` : "") +
            `📋 Evento: ${evento.eventLink}`;
          await sendWhatsAppMessage(provider.businessPhoneNumberId, config.ownerWhatsapp, notifMsg, token).catch(() => {});

          console.log(`[REUNIAO_AGENDADA] ✅ Evento criado | eventId=${evento.eventId} | conv ${conversationId}`);
        } else {
          console.error(`[REUNIAO_AGENDADA] Falha ao criar evento Google Calendar | conv ${conversationId}`);
        }
      } catch (e) {
        console.error("[REUNIAO_AGENDADA] Erro:", e);
      }
      // humanTakeover = false — IA continua disponível para reagendamentos
    }

    // ── Simular digitação antes da 1ª mensagem ────────────────────────────────
    if (incomingMessageId && provider.businessPhoneNumberId) {
      await simulateTypingDelay(provider.businessPhoneNumberId, incomingMessageId, mensagens[0] ?? mensagens.join(" "), to, token);
    }

    // ── Enviar mensagens com typing indicator entre cada bolha ────────────────
    for (let i = 0; i < mensagens.length; i++) {
      if (i > 0) {
        // Typing proporcional ao texto — 50ms por char, mínimo 800ms, máximo 3000ms
        const interDelay = Math.min(Math.max(mensagens[i].length * 50, 800), 3000);
        await sendTypingIndicator(provider.businessPhoneNumberId, to, interDelay, token);
        // Pausa micro entre typing e envio (simula o "send" humano)
        await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 250)));
      }

      const msgNow = new Date();
      await prisma.whatsappMessage.create({
        data: { content: mensagens[i], type: "TEXT", role: "ASSISTANT", sentAt: msgNow, status: "SENT", conversationId },
      });
      await sendWhatsAppMessage(provider.businessPhoneNumberId, to, mensagens[i], token, i === 0 ? contextMessageId : undefined);
    }

    // ── Envia Meet link ao cliente após as mensagens de texto da IA ─────────
    // O Meet link só está disponível após criarEventoReuniao() — não pode ir no array mensagens[]
    if (reuniaoMeetLink) {
      await new Promise((r) => setTimeout(r, 1000));
      await sendTypingIndicator(provider.businessPhoneNumberId, to, 1500, token).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));

      const meetMsg = `🗓️ Aqui está o link da reunião no Google Meet:\n\n${reuniaoMeetLink}`;
      await sendWhatsAppMessage(provider.businessPhoneNumberId, to, meetMsg, token).catch((e) => console.error("[REUNIAO_AGENDADA] Falha ao enviar Meet link:", e));
      await prisma.whatsappMessage.create({
        data: { content: meetMsg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
      }).catch(() => {});

      if (reuniaoDataLabel) {
        await new Promise((r) => setTimeout(r, 800));
        await sendTypingIndicator(provider.businessPhoneNumberId, to, 1200, token).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
        const confirmaMsg = `Confirmado para ${reuniaoDataLabel} 👊 qualquer dúvida é só chamar!`;
        await sendWhatsAppMessage(provider.businessPhoneNumberId, to, confirmaMsg, token).catch(() => {});
        await prisma.whatsappMessage.create({
          data: { content: confirmaMsg, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
        }).catch(() => {});
      }
    }

    // ── [PEDIDO_NACIONAL] — cria pedido e gera Pix/link ──────────────────────
    if (/\[PEDIDO_NACIONAL\]/i.test(combinedRaw)) {
      console.log(`[AI Agent] 🔔 [PEDIDO_NACIONAL] flag detectada — iniciando criação de pedido | conv ${conversationId} | cep=${collectedData.cep} | produto=${produtosContexto[0]?.nome ?? "?"} | pagamento=${collectedData.pagamento}`);
      try {
        const cepDestino    = collectedData.cep;
        const enderecoCompleto = collectedData.endereco;
        const nomeCliente   = collectedData.nome ?? lead?.profileName;
        const formaPagamento = collectedData.pagamento;
        const produto       = produtosContexto[0];

        if (cepDestino && enderecoCompleto && nomeCliente && formaPagamento && produto) {
          const baseUrl = getBaseUrl();
          const res = await fetch(`${baseUrl}/api/pedidos/nacional`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId,
              telefoneCliente: to,
              nomeCliente,
              produto: produto.nome,
              produtoId: produto.id,
              cepDestino,
              enderecoCompleto,
              formaPagamento: formaPagamento === "pix" ? "pix" : "parcelado",
            }),
          });

          if (res.ok) {
            const pedido = await res.json() as {
              pixCopiaECola?: string;
              linkPagamento?: string;
              valorTotal?: number;
              pedidoId?: string;
            };

            await prisma.whatsappConversation.update({
              where: { id: conversationId },
              data: { etapa: "PEDIDO_CONFIRMADO" },
            }).catch(() => {});
            await prisma.conversationFollowUp.updateMany({
              where: { conversationId, status: "ACTIVE" },
              data: { status: "DONE" },
            }).catch(() => {});
            await cancelFollowUpJobs(conversationId).catch(() => {});

            const valorStr = pedido.valorTotal
              ? `R$ ${pedido.valorTotal.toFixed(2).replace(".", ",")}`
              : "";

            if (pedido.pixCopiaECola) {
              await new Promise((r) => setTimeout(r, 1200));
              await sendWhatsAppMessage(
                provider.businessPhoneNumberId, to,
                `💰 *Pix gerado!* ${valorStr}\n\n🔑 *Código copia e cola:*\n\n${pedido.pixCopiaECola}\n\n⏰ Válido por 30 minutos`,
                token,
              );
              await prisma.whatsappMessage.create({
                data: { content: `[Pix gerado] ${valorStr}`, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
              }).catch(() => {});
            } else if (pedido.linkPagamento) {
              await new Promise((r) => setTimeout(r, 1200));
              await sendWhatsAppMessage(
                provider.businessPhoneNumberId, to,
                `💳 *Link para pagamento parcelado:*\n${pedido.linkPagamento}\n\n⏰ Válido por 24 horas`,
                token,
              );
              await prisma.whatsappMessage.create({
                data: { content: `[Link parcelado gerado]`, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
              }).catch(() => {});
            }
            console.log(`[AI Agent] ✅ PEDIDO_NACIONAL criado | pedidoId=${pedido.pedidoId}`);
          } else {
            const errText = await res.text();
            console.error(`[AI Agent] PEDIDO_NACIONAL API ${res.status}:`, errText);
            await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
              "❌ Erro ao gerar o pagamento. Aguarde um instante e tente novamente.", token);
          }
        } else {
          console.warn(`[AI Agent] PEDIDO_NACIONAL emitido mas dados incompletos | cep=${cepDestino} endereco=${!!enderecoCompleto} nome=${nomeCliente} pagamento=${formaPagamento} produto=${produto?.nome}`);
        }
      } catch (e) {
        console.error("[AI Agent] PEDIDO_NACIONAL error:", e);
      }
    }

    // ── [CHECKOUT] — cria checkout GPS e envia link público ──────────────────
    if (/\[CHECKOUT\]/i.test(combinedRaw)) {
      console.log(`[AI Agent] 🔔 [CHECKOUT] flag detectada | conv ${conversationId}`);
      try {
        const nomeCliente      = (sessaoNacional.nomeCliente as string | undefined) ?? collectedData.nome ?? lead?.profileName ?? undefined;
        const produto          = produtosContexto[0];
        const cepDestino       = (sessaoNacional.cep as string | undefined) ?? collectedData.cep ?? undefined;
        const enderecoCompleto = (sessaoNacional.enderecoCompleto as string | undefined) ?? collectedData.endereco ?? undefined;

        const baseUrl = getBaseUrl();

        const resCheckout = await fetch(`${baseUrl}/api/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            telefoneCliente: to,
            nomeCliente,
            produto: produto?.nome ?? undefined,
            valorProduto: produto?.preco ?? undefined,
            cep: cepDestino,
            enderecoCompleto,
          }),
        });

        if (resCheckout.ok) {
          const { url: checkoutUrl } = await resCheckout.json() as { id: string; url: string };

          await prisma.whatsappConversation.update({
            where: { id: conversationId },
            data: { etapa: "PEDIDO_CONFIRMADO" },
          }).catch(() => {});
          await cancelFollowUpJobs(conversationId).catch(() => {});

          const valorStr = produto ? `R$ ${produto.preco.toFixed(2).replace(".", ",")}` : "";

          await new Promise((r) => setTimeout(r, 800));
          await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
            `🛒 *Seu link de pagamento está pronto!*\n\n📦 ${produto?.nome ?? ""}${valorStr ? `\n💰 ${valorStr} — frete grátis` : ""}`.trim(),
            token);
          await new Promise((r) => setTimeout(r, 1000));
          await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
            `🔗 Acesse aqui e escolha Pix, cartão parcelado ou boleto:\n\n${checkoutUrl}`,
            token);
          await new Promise((r) => setTimeout(r, 800));
          await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
            `⏰ Link válido por 24h. Qualquer dúvida é só chamar! 👊`,
            token);

          await prisma.whatsappMessage.create({
            data: { content: `[Checkout gerado] ${checkoutUrl}`, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
          }).catch(() => {});

          console.log(`[AI Agent] ✅ CHECKOUT criado e link enviado | url=${checkoutUrl}`);
        } else {
          const errText = await resCheckout.text();
          console.error(`[AI Agent] CHECKOUT API ${resCheckout.status}:`, errText);
          await sendWhatsAppMessage(provider.businessPhoneNumberId, to,
            "❌ Erro ao gerar o link. Aguarde um instante e tente novamente.", token);
        }
      } catch (e) {
        console.error("[AI Agent] CHECKOUT error:", e);
      }
    }

    // Atualiza lastMessageAt e, se lead quente, avança etapa no banco
    // (necessário para o filtro "Quentes" do CRM detectar essas conversas)
    const novaEtapa = (() => {
      const etapaAtual = conversation.etapa;
      if (etapaAtual === "PEDIDO_CONFIRMADO" || etapaAtual === "PERDIDO") return undefined;
      if (leadState.tipo === "quente") return "COLETANDO_DADOS";
      if (leadState.tipo === "interessado" && (etapaAtual === "NOVO" || etapaAtual === "PRODUTO_IDENTIFICADO")) return "NEGOCIANDO";
      return undefined;
    })();
    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), ...(novaEtapa ? { etapa: novaEtapa } : {}) },
    });
    if (novaEtapa) console.log(`[AI Agent] etapa atualizada para "${novaEtapa}" | conv ${conversationId}`);
    if (leadState.tipo === "quente" && novaEtapa === "COLETANDO_DADOS") {
      notificarLeadQuente({
        nomeCliente:    lead?.profileName ?? to,
        mensagem:       userMessage,
        conversationId,
      }).catch(() => {});
    }

    // ── Enviar fotos + vídeo do produto ───────────────────────────────────────
    // WhatsApp exige URLs HTTPS públicas — converte base64 para endpoint público
    const appUrl = getBaseUrl();
    console.log(`[AI Agent] appUrl resolvido: "${appUrl}" | NEXTAUTH_URL=${process.env.NEXTAUTH_URL ?? "unset"} | RENDER_EXTERNAL_URL=${process.env.RENDER_EXTERNAL_URL ?? "unset"}`);
    const toPublicUrl = (url: string, productId: string, idx: number, isVideo = false): string => {
      if (url.startsWith("data:")) {
        if (!appUrl) {
          console.error("[AI Agent] ERRO: nenhuma URL pública configurada (NEXTAUTH_URL, RENDER_EXTERNAL_URL, etc.) — imagem base64 não pode ser enviada via WhatsApp");
          return "";
        }
        const publicUrl = isVideo ? `${appUrl}/api/media/product/${productId}?type=video` : `${appUrl}/api/media/product/${productId}?idx=${idx}`;
        console.log(`[AI Agent] base64 → URL pública: ${publicUrl}`);
        return publicUrl;
      }
      return url;
    };

    // ── midiasEnviadas: slugs de mídia já enviados nesta conversa (anti-duplicação) ──
    const midiasEnviadasRaw = (conversation as typeof conversation & { midiasEnviadas?: unknown }).midiasEnviadas;
    const midiasEnviadas: string[] = Array.isArray(midiasEnviadasRaw) ? (midiasEnviadasRaw as string[]) : [];
    const mediaAlreadySent = recentMessages.some((m) => m.type === "IMAGE" || m.type === "VIDEO");

    // Busca imageUrls de forma explícita (campo novo no schema)
    const productsWithMedia = await prisma.product.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
    });

    for (const product of productsWithMedia) {
      const slug = product.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

      // Trigger 1: Flag explícita gerada pela IA [FOTO_SLUG]
      const flagFoto  = new RegExp(`\\[FOTO_${slug}\\]`, "i").test(combinedRaw);
      const flagVideo = new RegExp(`\\[VIDEO_${slug}\\]`, "i").test(combinedRaw);

      // Trigger 2: Heurística — nome/keyword do produto na resposta + LLM falou em foto/vídeo
      const nameMentioned = new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(combinedRaw);
      // Dynamic keyword match — any word >3 chars from the product name appearing in IA response
      const nm = product.name.toLowerCase();
      const keywordMatch = nm.split(/\s+/).filter((w) => w.length > 3).some((w) =>
        combinedRaw.toLowerCase().includes(w)
      );
      const llmMentionedMedia = /\b(foto|fotos|v[ií]deo|videos?|imagem|imagens|enviar\s+as?\s+fotos?|mando\s+as?\s+fotos?)\b/i.test(combinedRaw);
      const autoSend = !mediaAlreadySent && msgCount <= 15 && (nameMentioned || keywordMatch) && llmMentionedMedia;

      // Trigger 3: LLM usou [FOTO] genérico sem slug — envia de qualquer produto ativo com mídia
      const genericFotoFlag  = /\[FOTO\b/i.test(combinedRaw) && !flagFoto;
      const genericVideoFlag = /\[VIDEO\b/i.test(combinedRaw) && !flagVideo;

      const slugFoto  = `FOTO_${slug}`;
      const slugVideo = `VIDEO_${slug}`;

      // Bloqueia se já enviou esta mídia nesta conversa
      const fotoJaEnviada  = midiasEnviadas.includes(slugFoto);
      const videoJaEnviado = midiasEnviadas.includes(slugVideo);

      const sendFoto  = !fotoJaEnviada  && (flagFoto  || autoSend || (genericFotoFlag  && !mediaAlreadySent));
      const sendVideo = !videoJaEnviado && (flagVideo || (autoSend && !!product.videoUrl) || (genericVideoFlag && !!product.videoUrl && !mediaAlreadySent));

      console.log(`[AI Agent] Product "${product.name}" slug=${slug}: flagFoto=${flagFoto} flagVideo=${flagVideo} nameMentioned=${nameMentioned} keywordMatch=${keywordMatch} llmMentionedMedia=${llmMentionedMedia} autoSend=${autoSend} sendFoto=${sendFoto} sendVideo=${sendVideo} fotoJaEnviada=${fotoJaEnviada} videoJaEnviado=${videoJaEnviado}`);

      if (sendFoto) {
        const imgs: string[] = (Array.isArray(product.imageUrls) && product.imageUrls.length > 0)
          ? product.imageUrls as string[]
          : product.imageUrl ? [product.imageUrl] : [];
        console.log(`[AI Agent] Sending ${imgs.length} image(s) for "${product.name}" | appUrl="${appUrl}"`);
        let imagesSent = 0;
        for (let i = 0; i < imgs.length; i++) {
          const imgUrl = toPublicUrl(imgs[i], product.id, i);
          if (!imgUrl) { console.error(`[AI Agent] imgUrl[${i}] vazio para "${product.name}" — pulando`); continue; }
          await new Promise((r) => setTimeout(r, 800));
          try {
            await sendWhatsAppImage(provider.businessPhoneNumberId, to, imgUrl, product.name, token);
            await prisma.whatsappMessage.create({
              data: { content: `[Imagem] ${product.name}`, type: "IMAGE", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
            }).catch(() => {});
            imagesSent++;
            console.log(`[AI Agent] ✅ Imagem ${i + 1}/${imgs.length} enviada para "${product.name}"`);
          } catch (e) {
            console.error(`[AI Agent] ❌ Image failed "${product.name}" idx=${i}:`, e);
          }
        }
        if (imagesSent > 0) {
          midiasEnviadas.push(slugFoto);
          await prisma.whatsappConversation.update({
            where: { id: conversationId },
            data: { midiasEnviadas: midiasEnviadas as unknown as import("@prisma/client").Prisma.InputJsonValue },
          }).catch(() => {});
        }
      }

      if (sendVideo && product.videoUrl) {
        const videoUrl = toPublicUrl(product.videoUrl, product.id, 0, true);
        if (!videoUrl) { console.error(`[AI Agent] videoUrl vazio para "${product.name}" — pulando`); continue; }
        console.log(`[AI Agent] Sending video for "${product.name}" url="${videoUrl.substring(0, 80)}"`);
        await new Promise((r) => setTimeout(r, 1000));
        try {
          await sendWhatsAppVideo(provider.businessPhoneNumberId, to, videoUrl, product.name, token);
          await prisma.whatsappMessage.create({
            data: { content: `[Vídeo] ${product.name}`, type: "VIDEO", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
          }).catch(() => {});
          midiasEnviadas.push(slugVideo);
          await prisma.whatsappConversation.update({
            where: { id: conversationId },
            data: { midiasEnviadas: midiasEnviadas as unknown as import("@prisma/client").Prisma.InputJsonValue },
          }).catch(() => {});
          console.log(`[AI Agent] ✅ Vídeo enviado para "${product.name}"`);
        } catch (e) {
          console.error(`[AI Agent] ❌ Video failed "${product.name}":`, e);
        }
      }
    }

    // ── [AUDIO:texto] — TTS via ElevenLabs/OpenAI ───────────────────────────────
    const audioFlagMatch = combinedRaw.match(/\[AUDIO:([^\]]+)\]/i);
    if (audioFlagMatch) {
      const audioText = audioFlagMatch[1].trim();
      if (audioText) {
        try {
          const { gerarAudio } = await import("@/lib/audio/gerar-audio");
          const { sendWhatsAppAudio } = await import("@/lib/whatsapp/send");
          const audioUrl = await gerarAudio(audioText);
          if (audioUrl) {
            await sendWhatsAppAudio(provider.businessPhoneNumberId, to, audioUrl, token);
            await prisma.whatsappMessage.create({
              data: { content: `[Áudio TTS] ${audioText.substring(0, 80)}`, type: "AUDIO", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
            }).catch(() => {});
            console.log(`[AI Agent] ✅ Áudio TTS enviado: "${audioText.substring(0, 50)}"`);
          } else {
            console.warn(`[AI Agent] ⚠️ gerarAudio retornou null para: "${audioText.substring(0, 50)}"`);
          }
        } catch (e) {
          console.error("[AI Agent] ❌ Áudio TTS falhou:", e);
        }
      }
    }

    // ── Agendar follow-up (só se não confirmado/perdido/fora de área) ──────────
    const skipFollowup =
      conversation.etapa === "PEDIDO_CONFIRMADO" ||
      conversation.etapa === "PERDIDO" ||
      conversation.foraAreaEntrega ||
      lead?.status === "CLOSED" ||
      lead?.status === "BLOCKED";
    if (!skipFollowup) {
      const nextSendAt = new Date(now.getTime() + FOLLOWUP_INTERVALS_MS[0]);
      const fu = await prisma.conversationFollowUp.upsert({
        where: { conversationId },
        update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null },
        create: { conversationId, step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null, phoneNumber: to, phoneNumberId: provider.businessPhoneNumberId, accessToken: provider.accessToken },
      });
      // Cancela jobs antigos e agenda o step 1 no BullMQ (complementa o cron)
      await cancelFollowUpJobs(conversationId).catch(() => {});
      await enqueueFollowUp(fu.id, conversationId, 1, to, provider.businessPhoneNumberId, lead?.profileName ?? null, provider.accessToken ?? null, now).catch(() => {});
    } else {
      console.log(`[AI Agent] Follow-up não agendado — etapa: ${conversation.etapa} | foraAreaEntrega: ${conversation.foraAreaEntrega} | lead: ${lead?.status}`);
      // Cancela jobs pendentes quando a conversa é encerrada
      await cancelFollowUpJobs(conversationId).catch(() => {});
    }

  } catch (error) {
    console.error("[AI Agent] Error:", error);
  }
}

async function callLLM(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  aiProvider?: string,
  aiModel?: string
): Promise<string | null> {
  const p = aiProvider?.toUpperCase();
  // Tenta o provider configurado primeiro
  if (p === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) { const r = await callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-haiku-4-5-20251001"); if (r) return r; }
  if (p === "OPENAI"    && process.env.OPENAI_API_KEY)    { const r = await callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini"); if (r) return r; }
  if (p === "GOOGLE"    && process.env.GOOGLE_AI_API_KEY) { const r = await callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite"); if (r) return r; }
  // Fallback chain
  if (process.env.ANTHROPIC_API_KEY) { const r = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001"); if (r) return r; }
  if (process.env.GOOGLE_AI_API_KEY) { const r = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite"); if (r) return r; }
  if (process.env.OPENAI_API_KEY)    { const r = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o-mini"); if (r) return r; }
  console.warn("[AI Agent] Nenhuma API key de LLM disponível");
  return null;
}

async function callOpenAI(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }], max_tokens: 400, temperature: 0.9 }),
  });
  if (!res.ok) { console.error("[OpenAI] Error:", await res.text()); return null; }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system: systemPrompt, messages: [...history, { role: "user", content: userMessage }], max_tokens: 400 }),
  });
  if (!res.ok) { console.error("[Anthropic] Error:", await res.text()); return null; }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string, model: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), { role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.9 },
    }),
  });
  if (!res.ok) { console.error("[Gemini] Error:", await res.text()); return null; }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function handleEscalation(leadId: string, conversationId: string, reason: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { kanbanColumn: true } });
  if (!lead || lead.status === "ESCALATED") return;

  const escalatedColumn = await prisma.kanbanColumn.findFirst({ where: { organizationId: lead.organizationId, type: "ESCALATED" } });
  if (escalatedColumn) {
    await prisma.lead.update({ where: { id: leadId }, data: { kanbanColumnId: escalatedColumn.id, status: "ESCALATED", lastActivityAt: new Date() } });
  }

  await prisma.leadEscalation.create({ data: { leadId, reason: reason.replace(/^\[ESCALAR\]\s*/i, "").substring(0, 500), status: "PENDING" } });
  await prisma.leadActivity.create({ data: { leadId, type: "STATUS_CHANGE", description: "Lead escalado para vendedor humano pela IA", createdBy: "AI_AGENT" } });
  await prisma.whatsappMessage.create({
    data: { content: "🔔 *Lead escalado para atendimento humano.* Um vendedor assumirá esta conversa em breve.", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
  });
}
