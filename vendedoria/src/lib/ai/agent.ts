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

  // Localização — pin nativo, link maps ou texto com rua/av/bairro/cep
  if (
    messages.some((m) => m.content.includes("[Localização recebida]")) ||
    messages.some((m) => /maps\.google|goo\.gl\/maps|lat:[-\d.]+ lng:/.test(m.content))
  ) {
    const locMsg = messages.find((m) => /\[Localização recebida\]|maps\.google|lat:[-\d.]/.test(m.content));
    data.localizacao = locMsg?.content ?? "pin enviado";
  } else {
    const endMsg = messages.find((m) =>
      m.role === "USER" && /\b(rua|av|avenida|travessa|alameda|est[a-z]*\.|bairro|cep\s*[:.]?\s*\d|setor|quadra|lote)\b/i.test(m.content)
    );
    if (endMsg) data.localizacao = endMsg.content;
  }

  // Endereço por escrito
  const enderecoMsg = messages.find((m) =>
    m.role === "USER" && /\b(rua|av\.|avenida|n[°º]?\s*\d|número|bairro|cep|goiânia|setor|quadra)\b/i.test(m.content) && m.content.length > 15
  );
  if (enderecoMsg) data.endereco = enderecoMsg.content;

  // Pagamento
  if (/\bdinheiro\b/.test(allText)) data.pagamento = "dinheiro";
  else if (/\bpix\b/.test(allText)) data.pagamento = "pix";
  else if (/\bcart[aã]o\b/.test(allText)) data.pagamento = "cartão";

  // Horário de recebimento
  const horarioMsg = messages.find((m) =>
    m.role === "USER" && /\b(\d{1,2})\s*[h:]\s*(\d{0,2})|(até|ate)\s+\d|hoje/.test(m.content)
  );
  if (horarioMsg) data.horario = horarioMsg.content;

  // Nome
  const nomeMsg = messages.find((m) =>
    m.role === "USER" && /^[A-ZÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]+(\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]+)+$/.test(m.content.trim())
  );
  if (nomeMsg) data.nome = nomeMsg.content.trim();

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
): string {
  const { hour, dayOfWeek } = getSaoPauloTime();
  const greeting = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
  const emoji    = aiConfig?.usarEmoji !== false;
  const nivel    = aiConfig?.nivelVenda ?? "medio";
  const dentroDoExpediente = isBusinessHours(hour, dayOfWeek);

  const entregaHoje = dentroDoExpediente
    ? "entrega pode ser HOJE — confirmar horário com o cliente"
    : "fora do expediente (seg-sex 9-18h, sáb 8-13h) — ofereça agendar para o próximo dia útil";

  // ── Dados já coletados (não perguntar de novo) ──────────────────────────────
  const coletados: string[] = [];
  if (collectedData.localizacao) coletados.push(`✅ Localização: ${collectedData.localizacao.substring(0, 80)}`);
  if (collectedData.endereco)    coletados.push(`✅ Endereço: ${collectedData.endereco.substring(0, 80)}`);
  if (collectedData.pagamento)   coletados.push(`✅ Pagamento: ${collectedData.pagamento}`);
  if (collectedData.horario)     coletados.push(`✅ Horário: ${collectedData.horario}`);
  if (collectedData.nome)        coletados.push(`✅ Nome: ${collectedData.nome}`);
  const dadosColetados = coletados.length > 0
    ? `\nDADOS JÁ COLETADOS (NÃO PERGUNTAR DE NOVO):\n${coletados.join("\n")}`
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
    etapa = `ETAPA 1 — PRIMEIRO CONTATO:
- Identifique o produto pela mensagem ("21v" ou "bomvink" = Bomvink 21V; "48v" ou "luatek" = Luatek 48V)
- Cumprimente com "${greeting}" em 1 balão separado, apresente-se como Leo da Nexo em outro balão
- Inclua IMEDIATAMENTE [FOTO_SLUG] E [VIDEO_SLUG] do produto identificado
- 2 benefícios curtos em balões separados
- 1 pergunta de qualificação (ex: "pra que você vai usar?")
- NÃO peça localização agora`;
  } else if (leadState.tipo === "quente") {
    // Verificar quais dados faltam
    const falta: string[] = [];
    if (!collectedData.endereco)  falta.push("endereço completo");
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
const DEFAULT_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil em Goiânia. Você tem 28 anos, é direto, bem-humorado na medida certa e sabe muito sobre ferramentas. Você não é um assistente — você é um vendedor que gosta do que faz e conhece o produto na palma da mão.
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

━━━ FLAGS ━━━
[OPT_OUT] — cliente pediu pra não ser contactado (nunca mais contatar)
[FOTO_SLUG] — envia foto(s) do produto (substitua SLUG pelo slug real)
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
    if (conversation.lead?.status === "ESCALATED") return;
    if ((conversation as typeof conversation & { humanTakeover?: boolean }).humanTakeover) {
      console.log(`[AI Agent] humanTakeover=true — skipping AI for conv ${conversationId}`);
      return;
    }

    // ── Sandbox mode ──────────────────────────────────────────────────────────
    if (agent.sandboxMode) {
      const sandboxNumber = process.env.SANDBOX_TEST_NUMBER ?? process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
      const customerNum = conversation.customerWhatsappBusinessId.replace(/\D/g, "");
      if (customerNum !== sandboxNumber.replace(/\D/g, "")) {
        console.log(`[AI Agent] Sandbox mode — skipping ${customerNum}`);
        return;
      }
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

    // ── Hard escalation check (antes do LLM, garante escalada mesmo que a IA erre) ──
    const hardEscalation = detectHardEscalation(
      userMessage,
      recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content })),
    );
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
    const runtimeCtx = buildRuntimeContext(
      leadState, msgCount, isFirstInteraction, aiConfig, collectedData,
      recentMessages.slice().reverse().map((m) => ({ role: m.role, content: m.content })),
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
      } catch (e) { console.error("[AI Agent] PASSAGEM parse error:", e); }
    }

    // ── [ESCALAR] soft trigger — DESATIVADO temporariamente ─────────────────
    // A IA não pode mais escalar por conta própria. Escalação só via Camada 1 (código).
    // Quando [ESCALAR] aparecer na resposta da IA, logamos mas NÃO escalamos.
    if (/\[ESCALAR\]/i.test(combinedRaw)) {
      console.log(`[ESCALATION] IA tentou emitir [ESCALAR] mas Camada 2 está DESATIVADA. Conv: ${conversationId} | Resp: ${rawResponse.substring(0, 200)}`);
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
    const appUrl = (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const toPublicUrl = (url: string, productId: string, idx: number, isVideo = false): string => {
      if (url.startsWith("data:")) {
        if (!appUrl) {
          console.error("[AI Agent] NEXTAUTH_URL não está definida — não é possível gerar URL pública para mídia base64");
          return "";
        }
        return isVideo ? `${appUrl}/api/media/product/${productId}?type=video` : `${appUrl}/api/media/product/${productId}?idx=${idx}`;
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

      // Trigger 2: Nome do produto mencionado na resposta + Etapa 2-3 + mídia ainda não enviada
      const nameMentioned = new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(combinedRaw);
      const autoSend = nameMentioned && !isFirstInteraction && !mediaAlreadySent && msgCount <= 10;

      const sendFoto  = flagFoto  || autoSend;
      const sendVideo = flagVideo || (autoSend && !!product.videoUrl);

      console.log(`[AI Agent] Product "${product.name}": flagFoto=${flagFoto} flagVideo=${flagVideo} nameMentioned=${nameMentioned} autoSend=${autoSend} sendFoto=${sendFoto} sendVideo=${sendVideo}`);

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

    // ── Agendar follow-up ─────────────────────────────────────────────────────
    const nextSendAt = new Date(now.getTime() + FOLLOWUP_INTERVALS_MS[0]);
    await prisma.conversationFollowUp.upsert({
      where: { conversationId },
      update: { step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null },
      create: { conversationId, step: 1, status: "ACTIVE", aiMessageAt: now, nextSendAt, leadName: lead?.profileName ?? null, phoneNumber: to, phoneNumberId: provider.businessPhoneNumberId, accessToken: provider.accessToken },
    });

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
