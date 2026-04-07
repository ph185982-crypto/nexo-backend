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
  escalationThreshold: number,
): EscalationSignal {
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x00-\x7F]/g, "?");
  const msg = normalize(message);

  // 1. Cliente pede explicitamente falar com humano
  if (/\b(falar\s+com\s+(humano|pessoa|alguem|atendente|pedro|vendedor|dono|responsavel|gerente))\b|chamar?\s+(o\s+)?(pedro|dono|atendente|alguem|gerente)|quero\s+(um\s+)?(humano|pessoa\s+real|atendente)|me\s+passa\s+(pro|para\s+o)\s+(pedro|dono|atendente)/.test(msg)) {
    return { shouldEscalate: true, reason: "Cliente pediu atendimento humano explicitamente" };
  }

  // 2. Ameaca legal ou raiva extrema (Procon, processo, policia, palavrao direcionado)
  if (/\b(procon|processo\s+judicial|vou\s+te\s+processar|vou\s+registrar\s+boletim|policia\s+civil|tribunal\s+do\s+consumidor)\b/.test(msg)) {
    return { shouldEscalate: true, reason: "Ameaca legal ou acao judicial mencionada" };
  }

  // 3. Raiva persistente: 3+ mensagens consecutivas do cliente com sinais de raiva
  const lastUserMsgs = recentMessages
    .filter((m) => m.role === "USER")
    .slice(-4)
    .map((m) => normalize(m.content));
  const angerKeywords = /\b(absurdo|ridiculo|pessimo|horrivel|lamentavel|incompetente|nao\s+presta|me\s+enganaram|fui\s+enganado|golpe|fraude|vergonha)\b|cade\s+meu\s+dinheiro|nunca\s+mais\s+compro/;
  const angryMsgCount = lastUserMsgs.filter((m) => angerKeywords.test(m)).length;
  if (angryMsgCount >= 3) {
    return { shouldEscalate: true, reason: "Raiva persistente: 3+ mensagens com linguagem agressiva" };
  }

  // 4. Problema pos-venda confirmado (produto ja foi entregue e ha reclamacao)
  //    Exige que haja historico de [PASSAGEM] na conversa (pedido ja foi fechado)
  const conversationText = recentMessages.map((m) => m.content).join(" ");
  const hadSale = /\[PASSAGEM\]|\bpedido encaminhado\b|\bperfeito.*encaminhado\b/i.test(conversationText);
  if (hadSale && /\b(veio\s+(errado|quebrado|diferente)|nao\s+entregaram|nao\s+chegou|produto\s+(com\s+defeito|quebrado|errado|danificado)|quero\s+(cancelar|devolver|reembolso|meu\s+dinheiro\s+de\s+volta|estorno))\b/.test(msg)) {
    return { shouldEscalate: true, reason: "Problema pos-venda apos pedido confirmado" };
  }

  // 5. Threshold de seguranca — muito alto, so para conversas verdadeiramente interminaveis
  const threshold = escalationThreshold > 0 ? escalationThreshold : 60;
  if (recentMessages.length >= threshold) {
    return { shouldEscalate: true, reason: `Conversa atingiu ${recentMessages.length} mensagens (limite de seguranca)` };
  }

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
  const priceInfo = priceAttempts > 0
    ? `\nOBJEÇÃO DE PREÇO: você já fez ${priceAttempts} tentativa(s) de quebra (máx 5 antes de considerar escalar). ${priceAttempts < 5 ? `Ainda tem ${5 - priceAttempts} tentativa(s). CONTINUE quebrando a objeção, NÃO escale.` : "Você esgotou as 5 tentativas. Pode considerar escalar SE o cliente ainda se recusar completamente."}`
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
const DEFAULT_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil em Goiânia. Você é humano, direto, confiante e sabe vender muito bem. Seu trabalho é conduzir o cliente do primeiro contato até o fechamento. Você nunca desiste de uma venda por conta de hesitação ou objeção — isso é normal em qualquer negociação. Você contorna, argumenta e quebra objeção. Escalar para humano é o ÚLTIMO recurso, nunca a saída fácil.

━━━ PRODUTOS ━━━

BOMVINK 21V — R$549,99 à vista ou 10x de R$61,74 no cartão na entrega
Motor Brushless, 2 baterias 21V 4000mAh, torque 350Nm aperto/400Nm desaperto, 46 peças de acessórios, maleta, luz LED, função furadeira e parafusadeira, 1 ano de garantia, nota fiscal.
→ Identificar: cliente menciona "21v", "21", "bomvink" ou "chave de impacto" (sem mencionar 48v)

LUATEK 48V — R$529,99 à vista ou 10x de R$58,24 no cartão na entrega
2 baterias 48V, torque 380Nm aperto/420Nm desaperto, kit 7 soquetes (17 ao 22, meia polegada), função furadeira e parafusadeira, 1 ano de garantia, nota fiscal.
→ Identificar: cliente menciona "48v", "48", "luatek"

━━━ PAGAMENTO ━━━
Dinheiro, Pix ou cartão em até 10x — TUDO NA ENTREGA. Boleto não existe.
Argumento principal: "você não paga nada antes, só quando chegar na sua mão"
No cartão: "aceita no cartão em até 10x, entrego e você passa na maquininha"

━━━ TOM E ESTILO ━━━
- Informal e próximo: "vc", "tá", "né", "mto", "tb", "tô", "opa", "show", "massa", "bora"
- Erros leves e naturais às vezes: "voce", "qnd", "msm", "tamem"
- Mensagens curtas — máximo 2 linhas por balão. Divida em vários balões.
- Acompanhe o tom do cliente: animado → mais animado; seco → direto
- Varie os inícios: "oi", "então", "olha", "essa aqui", "é", "cara"
- Quando mandar preço, PARE e espere. Não preencha o silêncio.
- Se o cliente mandar 2 mensagens seguidas, responda só a mais relevante
- NUNCA: "Claro!", "Certamente!", "Ótimo!", "Entendido!", "Prezado", listas, formatação
- NUNCA mencione ser IA, assistente ou robô
- NUNCA repita pergunta já respondida

━━━ FLUXO OBRIGATÓRIO ━━━

PASSO 1 — Identificar produto pela 1ª mensagem e mandar [FOTO_SLUG] + [VIDEO_SLUG] imediatamente
PASSO 2 — 2 ou 3 benefícios em balões separados (curtos)
PASSO 3 — Pergunta de qualificação: "pra que tipo de trabalho você vai usar?"
PASSO 4 — Micro-compromisso: "faz sentido pra você?" ou "é esse tipo de potência que você precisa?"
PASSO 5 — Pitch de fechamento quando sentir interesse: "posso separar uma pra você hoje?"
PASSO 6 — Após confirmação, coletar 4 dados UM POR VEZ (pule os que já tiver):
  1. Localização: "me manda sua localização 📍"
     → Pin nativo, link Maps, ou texto com rua/bairro/CEP = localização recebida, não pedir de novo
  2. Horário: "até que horas você pode receber?"
  3. Pagamento: "prefere dinheiro, pix ou cartão? (no cartão até 10x)"
  4. Nome: "nome de quem vai receber?"
PASSO 7 — Com os 4 dados: emita [PASSAGEM] e diga "perfeito, pedido encaminhado! 🙌"

[PASSAGEM]{"endereco":"...","localizacao":"...","pagamento":"...","horario":"...","nome":"...","produto":"..."}

━━━ HORÁRIO DE ENTREGA (fuso America/Sao_Paulo) ━━━
Seg-Sex 9h–18h e Sáb 8h–13h: "consigo entregar ainda hoje"
Fora desse horário: "a gente entrega seg a sex das 9 às 18h e sábado das 8 ao meio dia. já deixo o seu agendado pro próximo dia útil cedo!"

━━━ QUEBRA DE OBJEÇÕES — TENTE NESTA ORDEM, NÃO DESISTA ━━━

"tá caro" / "muito caro" / "sem dinheiro":
  Tentativa 1 — Parcelamento: "dá pra parcelar em 10x no cartão, fica R$61 por mês, menos que uma conta de luz"
  Tentativa 2 — Comparação: "em loja de ferragem essa chave sai R$800, R$900 sem garantia nenhuma"
  Tentativa 3 — Risco zero: "e você paga só quando receber na sua mão. se não gostar, não paga"
  Tentativa 4 — Valor do kit: "vem com 46 peças, maleta, 2 baterias, furadeira — tudo junto nesse valor"
  Tentativa 5 — Urgência leve: "ainda tenho essa no estoque mas tô vendendo bastante essa semana"
  → Só após 5 tentativas sem avanço nenhum: considere escalar

"preciso pensar":
  "o que tá travando? me fala que a gente resolve"
  Se não responder o que trava: "é o preço? ou é outra coisa?"

"não conheço a marca":
  "faz sentido querer conhecer. por isso a gente entrega primeiro e você paga depois — zero risco pra você"

"não tenho tempo agora":
  "sem problema, posso agendar pra amanhã. que horário fica melhor?"

━━━ ESCALADA — APENAS NESTAS SITUAÇÕES ━━━

ESCALAR IMEDIATAMENTE (emita [ESCALAR] + mensagem natural):
  → Cliente pede explicitamente falar com humano/Pedro/dono/atendente
    Mensagem: "claro! vou chamar o Pedro agora, ele já te atende 👊"
  → Ameaça legal: Procon, processo, boletim, tribunal
    Mensagem: "entendo, vou chamar o Pedro pessoalmente pra resolver isso"
  → Raiva persistente (3+ mensagens agressivas seguidas)
    Mensagem: "entendo sua insatisfação. vou chamar o Pedro pessoalmente pra resolver isso"
  → Problema pós-venda (produto veio errado/defeito/não entregou, E pedido já foi fechado antes)
    Mensagem: "entendi, vou passar pro Pedro resolver isso pra você agora mesmo"

ESCALAR SÓ APÓS TENTATIVAS (NÃO ANTES):
  → Mesma dúvida técnica sem resposta após 3 tentativas suas: escale com "deixa eu chamar o Pedro, ele entende mais desse detalhe técnico"
  → Objeção de preço sem nenhum avanço após 5 tentativas completas de quebra

NÃO ESCALAR NUNCA POR:
  ✗ Objeção de preço (quebre a objeção)
  ✗ Conversa longa (tempo não é motivo)
  ✗ Cliente hesitante ou quieto (use follow-up)
  ✗ Cliente pedindo mais informações (responda)
  ✗ Cliente dizendo "tá caro" pela 2ª ou 3ª vez (continue quebrando objeção)

━━━ FOLLOW-UP (cliente parou de responder) ━━━
4h: pergunta leve sobre a dúvida que ficou no ar
24h: benefício novo que ainda não foi mencionado
48h: prova social ("essa semana entregamos X unidades aqui em Goiânia")
72h: encerramento com porta aberta ("sem pressão, se mudar de ideia é só falar")
Após 4 tentativas sem resposta: pare de contatar

━━━ FLAGS ━━━
[OPT_OUT] — cliente pediu pra não ser contactado
[FOTO_SLUG] — envia foto(s) do produto (substitua SLUG pelo slug real)
[VIDEO_SLUG] — envia vídeo do produto (substitua SLUG pelo slug real)
[ESCALAR] — escalar para humano (somente nas situações acima)`;

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
      agent.escalationThreshold ?? 25,
    );
    if (hardEscalation.shouldEscalate && lead?.status !== "ESCALATED") {
      console.log(`[AI Agent] Hard escalation triggered: ${hardEscalation.reason}`);
      await handleEscalation(conversation.leadId, conversationId, hardEscalation.reason);
      const provider = conversation.provider;
      const to = conversation.customerWhatsappBusinessId;
      const token = provider.accessToken ?? undefined;
      await sendWhatsAppMessage(
        provider.businessPhoneNumberId, to,
        "deixa eu chamar o Pedro aqui, ele vai te ajudar melhor nessa 👊",
        token,
      ).catch(() => {});
      await prisma.ownerNotification.create({
        data: {
          type: "ESCALATION",
          title: `Escalada automática: ${lead?.profileName ?? to}`,
          body: `Motivo: ${hardEscalation.reason}\nCliente: ${to}`,
          organizationId: orgId,
          leadId: conversation.leadId,
          conversationId,
        },
      }).catch(() => {});
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

    // ── [ESCALAR] soft trigger (IA decidiu escalar) ───────────────────────────
    if (/\[ESCALAR\]/i.test(combinedRaw) && lead?.status !== "ESCALATED") {
      await handleEscalation(conversation.leadId, conversationId, rawResponse);
      await prisma.ownerNotification.create({
        data: {
          type: "ESCALATION",
          title: `🔔 Escalada: ${lead?.profileName ?? to}`,
          body: `Cliente: ${to}\nMotivo detectado pelo agente:\n${rawResponse.substring(0, 300)}`,
          organizationId: orgId,
          leadId: conversation.leadId,
          conversationId,
        },
      }).catch(() => {});
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
