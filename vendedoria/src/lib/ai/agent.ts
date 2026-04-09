import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppVideo, simulateTypingDelay } from "@/lib/whatsapp/send";

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
  // Detecta: "meu nome é X", "pode colocar no nome de X", ou mensagem que é só o nome
  const nomePatterns = [
    /(?:meu\s+nome\s+[eé]|nome\s+[eé]|pode\s+colocar\s+no\s+nome\s+(?:de|do|da)?|chamo[-\s]+me\s+|me\s+chamo\s+|sou\s+o?\s+)\s*([A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,}(?:\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,})*)/i,
  ];
  let nomeFound: string | undefined;
  for (const m of messages) {
    if (m.role !== "USER") continue;
    for (const re of nomePatterns) {
      const match = re.exec(m.content);
      if (match?.[1]) { nomeFound = match[1].trim(); break; }
    }
    if (nomeFound) break;
    // Mensagem que é só um nome (1-3 palavras, começa com maiúscula ou minúscula, sem pontuação especial)
    const trimmed = m.content.trim();
    if (/^[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]{2,}(\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]{2,}){0,3}$/.test(trimmed) && trimmed.length >= 4 && trimmed.length <= 60) {
      nomeFound = trimmed; break;
    }
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
      .replace(/[\u0300-\u036f]/g, "")
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

// ── CORREÇÃO 2: Detecção de área de entrega ──────────────────────────────────
// Só dispara quando o cliente informa explicitamente que é de outra cidade/estado.
// Não dispara por menção casual de cidade em contexto de uso do produto.
function detectForaDeArea(message: string): boolean {
  const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const norm = n(message);

  // Exige contexto de localização pessoal do cliente
  const temContextoLocal = /\b(sou de|sou do|sou da|sou la de|sou la|moro em|fico em|estou em|to de|minha cidade|vivo em|resido em|meu bairro|minha regiao|na minha cidade)\b/.test(norm);
  if (!temContextoLocal) return false;

  // Cidades da área de entrega — se mencionadas, não rejeitar
  const dentroArea = /\b(goiania|goias|aparecida de goiania|senador canedo|trindade|goianira|neropolis|hidrolandia|guapo|aragoiania|anapolis|bonfinopolis|terezopolis)\b/.test(norm);
  if (dentroArea) return false;

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
  const norm = message.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^(ok|oi|sim|nao|obrigado|obrigada|valeu|vlw|vlr|top|boa|show|certo|entendi|combinado|perfeito|blz|blzinha|beleza|otimo|😊|👍|🙏|✅|❤️|🙌|👏|k+|haha+|huhu|rs+|\.)$/.test(norm);
}

// ── Sanitiza mensagens — remove sobrecarga de dados e trunca textos longos ───
function sanitizeMessages(msgs: string[]): string[] {
  return msgs.map((m) => {
    if (isOverloadedRequest(m)) return "me manda sua localização 📍";
    if (m.length > 160) return m.substring(0, 157) + "...";
    return m;
  });
}

// ── Parser da resposta JSON do LLM ────────────────────────────────────────────
function parseAIResponse(raw: string): AIResponse {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { mensagens?: unknown; delays?: unknown };
    if (Array.isArray(parsed.mensagens) && parsed.mensagens.length > 0) {
      const msgs: string[] = (parsed.mensagens as unknown[]).map((m) => String(m).trim()).filter(Boolean);
      const rawDelays = Array.isArray(parsed.delays) ? (parsed.delays as unknown[]) : [];
      const delays: number[] = msgs.map((_, i) =>
        typeof rawDelays[i] === "number" ? (rawDelays[i] as number) : i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500
      );
      return { mensagens: sanitizeMessages(msgs), delays };
    }
  } catch { /* fall through */ }

  // Fallback: separador ||
  const byPipe = stripped.split("||").map((m) => m.trim()).filter(Boolean);
  if (byPipe.length > 1) {
    return { mensagens: sanitizeMessages(byPipe), delays: byPipe.map((_, i) => (i === 0 ? 0 : 1500 + Math.min(i - 1, 2) * 500)) };
  }

  return { mensagens: sanitizeMessages([stripped]), delays: [0] };
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
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7F]/g, "?");

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

  // ── Etapa da conversa ────────────────────────────────────────────────────────
  let etapa: string;

  if (isFirstInteraction) {
    // Monta flags reais dos produtos com mídia para o LLM usar
    const mediaFlags = (activeProducts ?? [])
      .filter(p => p.imageUrl || p.videoUrl)
      .map(p => {
        const s = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        return `[FOTO_${s}]${p.videoUrl ? ` e [VIDEO_${s}]` : ""}`;
      })
      .join("  |  ");
    const flagInstrucao = mediaFlags
      ? `- Inclua IMEDIATAMENTE os flags de mídia do produto identificado (flags disponíveis: ${mediaFlags})
- ATENÇÃO: você DEVE colocar o flag exato (ex: [FOTO_LUATEK_48V]) em um balão separado — isso é o que dispara o envio. Nunca diga "vou te enviar fotos" sem o flag.`
      : "- Descreva o produto em texto";
    etapa = `ETAPA 1 — PRIMEIRO CONTATO:
- Identifique o produto pela mensagem ("21v" ou "bomvink" = Bomvink 21V; "48v" ou "luatek" = Luatek 48V)
- Cumprimente com "${greeting}" em 1 balão separado, apresente-se como Léo da Nexo em outro balão
${flagInstrucao}
- 2 benefícios curtos em balões separados
- 1 pergunta de qualificação (ex: "pra que você vai usar?")
- NÃO peça localização agora`;
  } else if (leadState.tipo === "quente") {
    // Verificar quais dados faltam
    // Localização OU endereço é suficiente — não pedir os dois
    const temLocal = !!(collectedData.localizacao || collectedData.endereco);
    const falta: string[] = [];
    if (!temLocal)                falta.push("localização (pin 📍 ou texto: rua, bairro, CEP)");
    if (!collectedData.horario)   falta.push("até que horas pode receber");
    if (!collectedData.pagamento) falta.push("forma de pagamento (dinheiro, pix ou cartão)");
    if (!collectedData.nome)      falta.push("nome de quem vai receber");

    if (falta.length === 0) {
      etapa = `ETAPA 4 — FECHAR PEDIDO: você tem todos os dados. Emita [PASSAGEM] com os dados coletados e confirme ao cliente: "perfeito, pedido encaminhado! 🙌"`;
    } else {
      etapa = `ETAPA 4 — COLETAR DADOS (lead confirmou compra):
Dado que falta agora (1 por vez, não pergunte tudo de uma vez): ${falta[0]}
${falta.length > 1 ? `(depois ainda faltará: ${falta.slice(1).join(", ")})` : ""}
${entregaHoje}
NÃO repita dados já coletados acima.`;
    }
  } else if (msgCount <= 4 || leadState.tipo === "curioso") {
    etapa = `ETAPA 2 — QUALIFICAR E APRESENTAR:
- Se ainda não enviou mídia: inclua [FOTO_SLUG] e [VIDEO_SLUG] agora
- Entenda o uso do produto (faça 1 pergunta)
- Apresente 1-2 diferenciais relevantes para o uso dele
- NÃO peça localização`;
  } else if (leadState.tipo === "interessado" || msgCount <= 8) {
    etapa = `ETAPA 3 — CONVERTER:
- Reforce "só paga quando chegar na sua mão, sem risco"
- Use prova social: "aqui em Goiânia tô mandando bastante essa semana"
- Pergunte diretamente: "posso separar uma pra você?" ou "bora fechar?"
- Se ainda não enviou vídeo: inclua [VIDEO_SLUG] agora
- NÃO peça localização ainda`;
  } else if (leadState.tipo === "frio") {
    etapa = `ETAPA 3 — REENGAJAR:
- Use escassez natural: "essa tá acabando" ou "tenho poucas unidades"
- Remova objeção de preço: "e você só paga na entrega, sem risco"
- Inclua [FOTO_SLUG] se ainda não enviou`;
  } else {
    etapa = `ETAPA 3 — AVANÇAR: responda a dúvida e empurre suavemente para o fechamento. Se não enviou mídia, inclua agora.`;
  }

  const nivelInstr: Record<string, string> = {
    leve:      "Responda e deixe o cliente conduzir.",
    medio:     "Conduza naturalmente. Após responder, avance um passo.",
    agressivo: "Conduza ativamente. Use urgência com naturalidade.",
  };

  return [
    `\n\n--- RUNTIME ---`,
    `Hora SP: ${hour}h (${greeting}) | ${dentroDoExpediente ? "✅ Expediente aberto" : "🔴 Fora do expediente"}`,
    `Entrega: ${entregaHoje}`,
    `Lead: ${leadState.tipo} | Urgência: ${leadState.urgencia} | Msgs: ${msgCount} | 1ª vez: ${isFirstInteraction ? "SIM" : "NÃO"}`,
    `Emoji: ${emoji ? "SIM (máx 1/msg, não em toda msg)" : "NÃO"} | Nível: ${nivelInstr[nivel] ?? nivelInstr.medio}`,
    dadosColetados,
    priceInfo,
    ``,
    etapa,
    ``,
    `FORMATO OBRIGATÓRIO — responda SEMPRE em JSON:`,
    `{"mensagens": ["balão 1", "balão 2", "[FOTO_SLUG]", "balão 3"], "delays": [0, 1200, 600, 1500]}`,
    `• Cada balão = 1 frase curta (1-2 linhas)`,
    `• delays em ms entre balões (600-2000ms, simule digitação humana)`,
    `• Flags de mídia: [FOTO_SLUG] ou [VIDEO_SLUG] sozinhos no array (substitua SLUG pelo slug do produto)`,
    `• Sem "Claro!" "Ótimo!" "Entendido!" "Prezado" "Conforme" — fale como pessoa real`,
    `--- FIM RUNTIME ---`,
  ].filter(Boolean).join("\n");
}

// ── Prompt base (usado quando o agente não tem prompt customizado) ─────────────
const DEFAULT_SYSTEM_PROMPT = `Você é Léo, vendedor da Nexo Brasil em Goiânia. Você tem 28 anos, é direto, bem-humorado na medida certa e sabe muito sobre ferramentas. Você não é um assistente — você é um vendedor que gosta do que faz e conhece o produto na palma da mão.
Você nunca usa frases prontas. Cada mensagem sua é escrita na hora, pensando naquele cliente específico, naquele momento específico da conversa.

━━━ PERSONALIDADE ━━━

Você é confiante sem ser chato. Quando o cliente hesita, você não empurra — você entende e contorna. Você faz o cliente sentir que está falando com alguém que realmente quer ajudar, não com um sistema automático. Você tem bom humor leve — uma comparação engraçada aqui, uma observação esperta ali — mas sabe a hora de ser sério.

━━━ COMO VOCÊ ESCREVE ━━━

Mensagens curtas. Sempre divide em vários balões. Nunca manda textão.
Minúsculas na maior parte do tempo. Sem formalidade.
Pontuação informal. Reticências às vezes. Nada de ponto final em todo parágrafo.
Emojis com muita moderação — só quando reforça algo, não como decoração.
Erros leves ocasionais são naturais — "pra", "tá", "né", "to", "vc"
NUNCA use: "certamente", "claro", "com certeza", "fico feliz", "posso ajudá-lo", "prezado", "conforme", "segue"
Quando o cliente manda 2 mensagens seguidas, responde só a mais importante.

━━━ COMO VOCÊ LÊ O CLIENTE ━━━

Antes de responder, você analisa:
- Como ele escreve (formal, informal, gíria, direto, enrolado)
- O que ele demonstrou sentir (empolgado, desconfiado, com pressa, curioso)
- O que ele já disse antes na conversa — e usa isso
- Qual objeção ele já deu — você NUNCA repete argumento que já não funcionou

Você ajusta seu jeito de falar para espelhar o cliente. Com mecânico que escreve curto e direto, você é curto e direto. Com alguém mais animado, você anima junto. Com alguém desconfiado, você fica mais sério e objetivo.

━━━ PRODUTOS ━━━

BOMVINK 21V — R$549,99 à vista ou 10x no cartão
Motor Brushless (dura 2x mais que motor comum), 2 baterias 21V 4000mAh, torque 350Nm aperto / 400Nm desaperto, 46 peças incluídas na maleta, luz LED, função furadeira e parafusadeira, 1 ano de garantia, nota fiscal.
→ Quando o cliente menciona "21v" ou "bomvink" → esse é o produto dele.

LUATEK 48V — R$529,99 à vista ou 10x no cartão
2 baterias 48V, torque 380Nm aperto / 420Nm desaperto, kit com 7 soquetes do 17 ao 22 de meia polegada, função furadeira e parafusadeira, 1 ano de garantia, nota fiscal.
→ Quando o cliente menciona "48v" ou "luatek" → esse é o produto dele.

Pagamento aceito: dinheiro, Pix, cartão de crédito em até 10x na entrega. Boleto não.
Entrega: Goiânia e região. Pagamento só na entrega.
Horário de entrega: seg–sex 9h–18h, sábado 8h–13h. Fora desse horário agenda pro próximo dia útil.

━━━ O QUE VOCÊ PRECISA ALCANÇAR EM CADA ETAPA — mas sem frases fixas, com suas próprias palavras ━━━

Etapa 1 — Abertura: se apresentar de forma natural, identificar o produto pelo que o cliente escreveu, já mandar o vídeo + foto sem o cliente precisar pedir.
Etapa 2 — Conexão: fazer uma pergunta que mostre interesse real no uso que ele vai dar. Não é interrogatório — é curiosidade genuína. "pra que você vai usar mais?" dito de formas diferentes sempre.
Etapa 3 — Apresentação: falar de 2 ou 3 benefícios que fazem sentido pro perfil dele. Se é mecânico, foca no torque e na durabilidade. Se é uso em casa, foca na praticidade e no kit completo. Não lista tudo — escolhe o que importa pra aquele cliente.
Etapa 4 — Micro-compromisso: antes de fechar, conseguir que o cliente concorde com pelo menos uma coisa. Uma pergunta que a resposta natural é sim.
Etapa 5 — Fechamento: quando sentir que o cliente está pronto, fechar com naturalidade. Não é "vamos fechar?" — é "então bora, me passa o endereço".
Etapa 6 — Coleta de dados: pegar os 4 dados em conversa natural, um de cada vez, sem parecer formulário:
  1. endereço completo
  2. até que horas pode receber
  3. forma de pagamento
  4. nome de quem vai receber

Etapa 7 — Resumo: enviar para 62984465388 neste formato:
🔔 PEDIDO — NEXO
Produto:
Nome:
Endereço:
Receber até:
Pagamento:
WhatsApp do cliente:

━━━ OBJEÇÕES — você tenta de formas diferentes, nunca repete o mesmo argumento ━━━

"tá caro":
  → tente em ordem: parcelamento / comparação com ferragem / risco zero pagar na entrega / valor do kit completo / urgência de estoque
  → NUNCA escala por preço — continue tentando enquanto o cliente estiver respondendo

"preciso pensar":
  → descobre o que está travando. "o que tá segurando?"
  → Se não responder o que é, pergunta diretamente se é o preço ou outra coisa.

"não conheço a marca":
  → usa o argumento do risco zero. Pagar na entrega elimina qualquer risco de comprar de desconhecido.

━━━ IMPORTANTE: VOCÊ NÃO DECIDE QUANDO ESCALAR ━━━

Escalada é controlada pelo sistema, não por você.
Você NUNCA deve emitir [ESCALAR] na sua resposta.
Continue a conversa sempre, independente de quantas mensagens já foram trocadas ou quantas objeções de preço o cliente fez.
A única coisa que encerra uma conversa é: pedido fechado [PASSAGEM] ou cliente pediu pra não ser contactado [OPT_OUT].

━━━ FOLLOW-UP quando cliente para de responder ━━━
4h → toca leve, pergunta se ficou dúvida
24h → traz um benefício novo que não mencionou antes
48h → usa prova social, alguém que comprou recentemente
72h → encerra com porta aberta, sem pressão
Após 4 sem resposta → PERDA, para de contatar.

━━━ FLAGS — REGRAS CRÍTICAS ━━━
NUNCA escreva "vou te enviar fotos", "mando as fotos agora" ou similar SEM incluir o flag correspondente.
O sistema SOMENTE envia fotos/vídeo quando o flag aparece na resposta. Se você prometer mas não incluir o flag, a foto nunca chega.
Sempre que quiser enviar mídia, coloque o flag na mesma resposta, em um balão separado (ex: "[FOTO_LUATEK_48V]").

[OPT_OUT] — cliente pediu pra não ser contactado (nunca mais contatar)
[FOTO_SLUG] — envia foto(s) do produto (substitua SLUG pelo slug real do catálogo)
[VIDEO_SLUG] — envia vídeo do produto (substitua SLUG pelo slug real)
[PASSAGEM]{"endereco":"...","localizacao":"...","pagamento":"...","horario":"...","nome":"...","produto":"..."} — emitir ao ter todos os 4 dados`;

export async function processAIResponse(
  conversationId: string,
  userMessage: string,
  agent: AgentConfig,
  incomingMessageId?: string
): Promise<void> {
  try {
    const [recentMessages, conversation] = await Promise.all([
      prisma.whatsappMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        take: 30,
      }),
      prisma.whatsappConversation.findUnique({
        where: { id: conversationId },
        include: { provider: true, lead: true },
      }),
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

    // ── CORREÇÃO 2: Área de entrega ───────────────────────────────────────────
    if (conversation.foraAreaEntrega) {
      console.log(`[AI Agent] foraAreaEntrega=true — ignorando mensagem para conv ${conversationId}`);
      return;
    }

    if (detectForaDeArea(userMessage)) {
      const to = conversation.customerWhatsappBusinessId;
      const token = conversation.provider.accessToken ?? undefined;
      console.log(`[AI Agent] Fora de área detectado para conv ${conversationId}: "${userMessage}"`);

      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "boa tarde! infelizmente a gente faz entrega só em Goiânia e região por enquanto 😅",
        token,
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 1400));
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "se um dia expandirmos pra aí eu te aviso! obrigado pelo interesse 👊",
        token,
      ).catch(() => {});

      const rejectionNow = new Date();
      await prisma.whatsappMessage.createMany({
        data: [
          { content: "boa tarde! infelizmente a gente faz entrega só em Goiânia e região por enquanto 😅", type: "TEXT", role: "ASSISTANT", sentAt: rejectionNow, status: "SENT", conversationId },
          { content: "se um dia expandirmos pra aí eu te aviso! obrigado pelo interesse 👊", type: "TEXT", role: "ASSISTANT", sentAt: new Date(rejectionNow.getTime() + 1400), status: "SENT", conversationId },
        ],
      }).catch(() => {});
      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { foraAreaEntrega: true, etapa: "PERDIDO", lastMessageAt: rejectionNow },
      }).catch(() => {});
      await prisma.conversationFollowUp.updateMany({
        where: { conversationId, status: "ACTIVE" },
        data: { status: "DONE" },
      }).catch(() => {});
      return;
    }

    // ── CORREÇÃO 3: Silêncio pós-confirmação ──────────────────────────────────
    if (conversation.etapa === "PEDIDO_CONFIRMADO") {
      if (isCourtesyMessage(userMessage)) {
        console.log(`[AI Agent] Pós-confirmação: cortesia ignorada "${userMessage}"`);
        return;
      }
      const cortesias = conversation.cortesiasAposConf ?? 0;
      if (cortesias >= 2) {
        console.log(`[AI Agent] Pós-confirmação: cortesiasAposConf=${cortesias} >= 2 — não responder mais`);
        return;
      }
      const to = conversation.customerWhatsappBusinessId;
      const token = conversation.provider.accessToken ?? undefined;
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "qualquer dúvida pode chamar 👊 nossa equipe entra em contato em breve",
        token,
      ).catch(() => {});
      await prisma.whatsappMessage.create({
        data: { content: "qualquer dúvida pode chamar 👊 nossa equipe entra em contato em breve", type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId },
      }).catch(() => {});
      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { cortesiasAposConf: cortesias + 1, lastMessageAt: new Date() },
      }).catch(() => {});
      console.log(`[AI Agent] Pós-confirmação: respondeu cortesia ${cortesias + 1}/2`);
      return;
    }

    // ── Contexto ──────────────────────────────────────────────────────────────
    const lead = conversation.lead;
    const orgId = conversation.provider.organizationId;

    // Contagem de mensagens trocadas (para detectar etapa da conversa)
    const msgCount = recentMessages.length;
    const isFirstInteraction = recentMessages.filter((m) => m.role === "ASSISTANT").length === 0;

    // Quote the latest message if client sent 2+ in a row without reply
    let consecutiveUser = 0;
    for (const m of recentMessages) { if (m.role === "USER") consecutiveUser++; else break; }
    const contextMessageId = consecutiveUser > 1 && incomingMessageId ? incomingMessageId : undefined;

    // ── Detectar estado do lead ───────────────────────────────────────────────
    const leadState = detectLeadState(userMessage);

    // ── Guard: intenção de compra bloqueia qualquer escalação ────────────────
    // Se o cliente quer fechar/comprar, NUNCA escalar — vai direto para coleta de dados
    const msgNorm = userMessage.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
      await sendWhatsAppMessage(
        conversation.provider.businessPhoneNumberId, to,
        "deixa eu chamar o Pedro aqui, ele vai te ajudar melhor nessa 👊",
        token,
      ).catch(() => {});
      return;
    }

    // ── Carregar AiConfig ─────────────────────────────────────────────────────
    const aiConfig = await prisma.aiConfig.findUnique({ where: { organizationId: orgId } }).catch(() => null);

    // ── Produtos ativos ───────────────────────────────────────────────────────
    const activeProducts = await prisma.product.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    // ── CORREÇÃO 4: Envio forçado de mídia no primeiro contato ───────────────
    // Detecta produto pela mensagem do usuário e envia foto+vídeo IMEDIATAMENTE,
    // antes da IA responder. Não depende de flag — sempre funciona.
    const appUrlEarly = (
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.RENDER_EXTERNAL_URL ??
      (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "")
    ).replace(/\/$/, "");
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
      const productsWithMediaEarly = await prisma.product.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true, imageUrl: true, imageUrls: true, videoUrl: true },
      });
      for (const prod of productsWithMediaEarly) {
        const nm = prod.name.toLowerCase();
        const matchesByName = msgLower.includes(nm);
        const matchesByKeyword =
          (/21v|bomvink/.test(msgLower) && (nm.includes("21") || nm.includes("bomvink"))) ||
          (/48v|luatek/.test(msgLower) && (nm.includes("48") || nm.includes("luatek")));
        if (!matchesByName && !matchesByKeyword) continue;

        console.log(`[AI Agent] FORCED first-contact media for "${prod.name}" | appUrlEarly="${appUrlEarly}"`);
        const imgs: string[] = prod.imageUrls?.length ? prod.imageUrls : prod.imageUrl ? [prod.imageUrl] : [];
        console.log(`[AI Agent] ${imgs.length} imagens encontradas para "${prod.name}" | videoUrl=${!!prod.videoUrl}`);
        for (let i = 0; i < imgs.length; i++) {
          const imgUrl = toPublicUrlEarly(imgs[i], prod.id, i);
          console.log(`[AI Agent] imgUrl[${i}]: "${imgUrl.substring(0, 80)}"`);
          if (!imgUrl) { console.error(`[AI Agent] imgUrl[${i}] vazio — pulando`); continue; }
          await new Promise((r) => setTimeout(r, 500));
          await sendWhatsAppImage(
            conversation.provider.businessPhoneNumberId,
            conversation.customerWhatsappBusinessId,
            imgUrl, prod.name,
            conversation.provider.accessToken ?? undefined,
          ).catch((e) => console.error(`[AI Agent] Forced image failed:`, e));
        }
        if (prod.videoUrl) {
          const vidUrl = toPublicUrlEarly(prod.videoUrl, prod.id, 0, true);
          if (vidUrl) {
            await new Promise((r) => setTimeout(r, 800));
            await sendWhatsAppVideo(
              conversation.provider.businessPhoneNumberId,
              conversation.customerWhatsappBusinessId,
              vidUrl, prod.name,
              conversation.provider.accessToken ?? undefined,
            ).catch((e) => console.error(`[AI Agent] Forced video failed:`, e));
          }
        }
        break; // envia apenas o primeiro produto identificado
      }
    }

    let productSection = "";
    if (activeProducts.length > 0) {
      const lines = activeProducts.map((p, i) => {
        const slug = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        const hasMedia = p.imageUrl || (p as typeof p & { imageUrls?: string[] }).imageUrls?.length || p.videoUrl;
        return [
          `Produto ${i + 1} — ${p.name} [slug: ${slug}]`,
          p.description ?? null,
          `Preço: R$${p.price.toFixed(2)}${p.priceInstallments && p.installments ? ` à vista | ${p.installments}x de R$${p.priceInstallments.toFixed(2)}` : ""}`,
          hasMedia ? `→ Para enviar fotos/vídeo: inclua [FOTO_${slug}] ou [VIDEO_${slug}] em uma das mensagens` : null,
        ].filter(Boolean).join("\n");
      });
      productSection = "\n\nCATÁLOGO:\n" + lines.join("\n\n");
    }

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

    // ── CORREÇÃO 5: Passagem automática por código quando todos os dados estão coletados ──
    const temEndereco  = !!(collectedData.endereco || collectedData.localizacao);
    const dadosCompletos = temEndereco && !!collectedData.horario && !!collectedData.pagamento && !!collectedData.nome;
    const passagemJaFeita = recentMessages.some((m) => /\[PASSAGEM\]/.test(m.content));
    if (dadosCompletos && !passagemJaFeita) {
      console.log(`[AI Agent] PASSAGEM AUTOMÁTICA ativada por código — todos os 4 dados coletados`);
      const produtoNome = activeProducts[0]?.name ?? "produto";
      const clientName  = lead?.profileName ?? "Cliente";
      const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
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
        `*🔔 PEDIDO NOVO — NEXO BRASIL*\n\n` +
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
      return; // não chamar LLM — pedido já encerrado
    }

    // ── Sandbox mode (após passagem — passagem sempre dispara, sandbox só bloqueia IA) ──
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      if (customerNum !== sandboxNumber.replace(/\D/g, "")) {
        console.log(`[AI Agent] Sandbox mode — skipping AI for ${customerNum}`);
        return;
      }
    }

    const runtimeCtx = buildRuntimeContext(
      leadState, msgCount, isFirstInteraction, aiConfig, collectedData,
      recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content })),
      activeProducts,
    );
    const systemPromptFinal = basePrompt + productSection + leadContext + runtimeCtx;

    // ── Histórico de chat ─────────────────────────────────────────────────────
    const chatHistory = recentMessages
      .slice()
      .reverse()
      .slice(0, -1)
      .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

    // ── Chamada ao LLM ────────────────────────────────────────────────────────
    const rawResponse = await callLLM(systemPromptFinal, chatHistory, userMessage, agent.aiProvider ?? undefined, agent.aiModel ?? undefined);
    if (!rawResponse) return;

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
        .replace(mediaFlagRe, "")
        .trim()
    ).filter(Boolean);

    if (mensagens.length === 0) return;

    const provider = conversation.provider;
    const to = conversation.customerWhatsappBusinessId;
    const token = provider.accessToken ?? undefined;
    const now = new Date();

    // ── [OPT_OUT] ─────────────────────────────────────────────────────────────
    if (/\[OPT_OUT\]/i.test(combinedRaw)) {
      await Promise.all([
        prisma.lead.update({ where: { id: conversation.leadId }, data: { status: "BLOCKED" } }),
        prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "OPT_OUT" } }),
      ]);
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
          `*🔔 PEDIDO NOVO — NEXO BRASIL*\n\n` +
          `👤 *Cliente:* ${clientName}\n` +
          `📱 *WhatsApp:* ${to}\n` +
          `📦 *Produto:* ${produtoStr}\n` +
          `📍 *Localização:* ${orderData.localizacao ?? "não enviada"}\n` +
          `🏠 *Endereço:* ${orderData.endereco ?? "?"}\n` +
          `💳 *Pagamento:* ${orderData.pagamento ?? "?"}\n` +
          `🕐 *Recebe até:* ${orderData.horario ?? "?"}\n` +
          `🙍 *Nome recebedor:* ${orderData.nome ?? clientName}\n\n` +
          `_Organize a entrega e encaminhe o motoboy._`;
        const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
        await sendWhatsAppMessage(provider.businessPhoneNumberId, ownerNumber, handoffMsg, token)
          .catch((e) => console.error("[AI Agent] Passagem send failed:", e));
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

    // ── Simular digitação antes da 1ª mensagem ────────────────────────────────
    if (incomingMessageId && provider.businessPhoneNumberId) {
      await simulateTypingDelay(provider.businessPhoneNumberId, incomingMessageId, mensagens.join(" "), token);
    }

    // ── Enviar mensagens com delays individuais ───────────────────────────────
    for (let i = 0; i < mensagens.length; i++) {
      const delayMs = delays[i] ?? 0;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const msgNow = new Date();
      await prisma.whatsappMessage.create({
        data: { content: mensagens[i], type: "TEXT", role: "ASSISTANT", sentAt: msgNow, status: "SENT", conversationId },
      });
      await sendWhatsAppMessage(provider.businessPhoneNumberId, to, mensagens[i], token, i === 0 ? contextMessageId : undefined);
    }

    await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });

    // ── Enviar fotos + vídeo do produto ───────────────────────────────────────
    // WhatsApp exige URLs HTTPS públicas — converte base64 para endpoint público
    const appUrl = (
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.RENDER_EXTERNAL_URL ??
      (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "")
    ).replace(/\/$/, "");
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

    // Verifica se algum produto já teve mídia enviada nesta conversa (evita duplicar)
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
      const nm = product.name.toLowerCase();
      const keywordMatch =
        (/luatek|48\s*v/i.test(combinedRaw) && (nm.includes("luatek") || nm.includes("48"))) ||
        (/bomvink|21\s*v/i.test(combinedRaw) && (nm.includes("bomvink") || nm.includes("21")));
      const llmMentionedMedia = /\b(foto|fotos|v[ií]deo|videos?|imagem|imagens|enviar\s+as?\s+fotos?|mando\s+as?\s+fotos?)\b/i.test(combinedRaw);
      const autoSend = !mediaAlreadySent && msgCount <= 15 && (nameMentioned || keywordMatch) && llmMentionedMedia;

      // Trigger 3: LLM usou [FOTO] genérico sem slug — envia de qualquer produto ativo com mídia
      const genericFotoFlag  = /\[FOTO\b/i.test(combinedRaw) && !flagFoto;
      const genericVideoFlag = /\[VIDEO\b/i.test(combinedRaw) && !flagVideo;

      const sendFoto  = flagFoto  || autoSend || (genericFotoFlag  && !mediaAlreadySent);
      const sendVideo = flagVideo || (autoSend && !!product.videoUrl) || (genericVideoFlag && !!product.videoUrl && !mediaAlreadySent);

      console.log(`[AI Agent] Product "${product.name}" slug=${slug}: flagFoto=${flagFoto} flagVideo=${flagVideo} nameMentioned=${nameMentioned} keywordMatch=${keywordMatch} llmMentionedMedia=${llmMentionedMedia} autoSend=${autoSend} sendFoto=${sendFoto} sendVideo=${sendVideo}`);

      if (sendFoto) {
        const imgs: string[] = product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];
        console.log(`[AI Agent] Sending ${imgs.length} image(s) for "${product.name}"`);
        for (let i = 0; i < imgs.length; i++) {
          const imgUrl = toPublicUrl(imgs[i], product.id, i);
          if (!imgUrl) continue;
          await new Promise((r) => setTimeout(r, 800));
          await sendWhatsAppImage(provider.businessPhoneNumberId, to, imgUrl, product.name, token)
            .catch((e) => console.error(`[AI Agent] Image failed "${product.name}":`, e));
        }
      }

      if (sendVideo && product.videoUrl) {
        const videoUrl = toPublicUrl(product.videoUrl, product.id, 0, true);
        if (!videoUrl) continue;
        console.log(`[AI Agent] Sending video for "${product.name}"`);
        await new Promise((r) => setTimeout(r, 1000));
        await sendWhatsAppVideo(provider.businessPhoneNumberId, to, videoUrl, product.name, token)
          .catch((e) => console.error(`[AI Agent] Video failed "${product.name}":`, e));
      }
    }

    // ── CORREÇÃO 4: Agendar follow-up (só se não confirmado/perdido/fora de área) ──
    const skipFollowup =
      conversation.etapa === "PEDIDO_CONFIRMADO" ||
      conversation.etapa === "PERDIDO" ||
      conversation.foraAreaEntrega ||
      lead?.status === "CLOSED" ||
      lead?.status === "BLOCKED";
    if (!skipFollowup) {
      const nextSendAt = new Date(now.getTime() + FOLLOWUP_INTERVALS_MS[0]);
      await prisma.conversationFollowUp.upsert({
        where: { conversationId },
        update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null },
        create: { conversationId, step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null, phoneNumber: to, phoneNumberId: provider.businessPhoneNumberId, accessToken: provider.accessToken },
      });
    } else {
      console.log(`[AI Agent] Follow-up não agendado — etapa: ${conversation.etapa} | foraAreaEntrega: ${conversation.foraAreaEntrega} | lead: ${lead?.status}`);
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
