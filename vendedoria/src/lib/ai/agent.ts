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
  // Normalize: lowercase + remove diacritics for ASCII-safe matching
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x00-\x7F]/g, "?");
  const msg = normalize(message);
  const msgCount = recentMessages.length;

  // 1. Cliente pede explicitamente humano
  if (/\b(falar\s+com\s+(humano|pessoa|alguem|atendente|pedro|vendedor|dono|responsavel))\b|chamar?\s+(o\s+)?(pedro|dono|atendente|alguem)|quero\s+(um\s+)?(humano|pessoa\s+real|atendente)/.test(msg)) {
    return { shouldEscalate: true, reason: "Cliente pediu atendimento humano explicitamente" };
  }

  // 2. Raiva / frustração intensa
  if (/\b(absurdo|ridiculo|pessimo|horrivel|lamentavel)\b|vou\s+reclamar|me\s+enganaram|fui\s+enganado|jamais\s+compro|nunca\s+mais\s+compro|cade\s+meu\s+dinheiro/.test(msg)) {
    return { shouldEscalate: true, reason: "Frustracao ou raiva intensa detectada" };
  }

  // 3. Problema com pedido anterior / pos-venda
  if (/\b(veio\s+(errado|quebrado)|nao\s+entregaram|nao\s+chegou|produto\s+(com\s+defeito|quebrado|errado)|quero\s+(cancelar|devolver|reembolso|meu\s+dinheiro\s+de\s+volta))\b/.test(msg)) {
    return { shouldEscalate: true, reason: "Problema pos-venda ou reclamacao de entrega" };
  }

  // 4. Conversa muito longa sem fechamento
  const threshold = escalationThreshold > 0 ? escalationThreshold : 25;
  if (msgCount >= threshold) {
    return { shouldEscalate: true, reason: `Conversa atingiu ${msgCount} mensagens sem fechamento` };
  }

  // 5. Objecao de preco repetida 3+ vezes nas ultimas 6 mensagens do cliente
  const userMsgs = recentMessages.filter((m) => m.role === "USER").slice(-6);
  const priceObjections = userMsgs.filter((m) =>
    /\b(caro|caro\s+demais|muito\s+caro|ta\s+caro|preco\s+alto|sem\s+dinheiro|nao\s+tenho\s+dinheiro)\b/.test(normalize(m.content))
  ).length;
  if (priceObjections >= 3) {
    return { shouldEscalate: true, reason: "Objecao de preco repetida 3 ou mais vezes" };
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

// ── Contexto de runtime injetado no prompt a cada chamada ────────────────────
function buildRuntimeContext(
  leadState: LeadState,
  msgCount: number,
  isFirstInteraction: boolean,
  aiConfig: { usarEmoji: boolean; usarReticencias: boolean; nivelVenda: string } | null,
  collectedData: CollectedData,
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
const DEFAULT_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil — ferramentas profissionais, entrega em Goiânia e região.

━━━ QUEM É PEDRO ━━━
Pedro tem 5 anos vendendo ferramentas. Fala como amigo que entende do assunto — não como SAC ou robô.
É direto, leve, não enrola. Quando o cliente está animado, Pedro fica animado. Quando o cliente é seco, Pedro é direto.

Pedro NUNCA diz: "Claro!", "Certamente!", "Ótimo!", "Entendido!", "Prezado", "Conforme mencionado", "Como posso ajudar?".
Pedro NUNCA usa listas ou formatação markdown.
Pedro NUNCA escreve parágrafos — cada mensagem = 1 frase curta (máx 2 linhas).
Pedro NUNCA menciona ser IA, assistente virtual ou robô.
Pedro NUNCA repete uma pergunta que o cliente já respondeu.

━━━ COMO PEDRO FALA ━━━
- Linguagem informal: "vc", "tá", "né", "mto", "tb", "pq", "tô", "opa", "show", "massa", "bora", "fechado"
- Erros leves naturais às vezes: "voce", "qnd", "msm", "tamem"
- Acompanha o tom do cliente: se o cliente é animado → Leo usa "opa!", "show!"; se seco → Leo é direto
- Varia os inícios: "oi", "então", "olha", "essa aqui", "é", "cara", "aqui"
- Quando manda preço, para e espera. Não preenche o silêncio.

━━━ PAGAMENTO — REGRAS FIXAS ━━━
- Pagamento SOMENTE na entrega — dinheiro, Pix ou cartão (até 10x)
- NUNCA mencione boleto — não existe essa opção
- Argumento principal: "vc não paga nada antes, só quando chegar na sua mão"
- No cartão: "aceita no cartão em até 10x na entrega"

━━━ O QUE LEO SABE ━━━
- Entrega em Goiânia e região — sem retirada presencial
- Nota fiscal + 1 ano de garantia em tudo
- Prova social: "aqui em Goiânia tô mandando bastante essa semana", "profissional que usa todo dia escolhe essa"
- Escassez plausível: "essa tá acabando", "tenho poucas unidades"
- Linguagem assumida: "quando chegar na sua mão", "aí na sua obra", "vc vai notar a diferença"

━━━ FOTOS E VÍDEOS ━━━
Sempre que apresentar um produto, inclua [FOTO_SLUG] em uma das mensagens do JSON.
Quando o cliente demonstrar interesse real, inclua também [VIDEO_SLUG].
Substitua SLUG pelo slug exato do produto (disponível no catálogo).
NUNCA descreva o produto em texto longo — deixe a mídia falar por si.

━━━ FECHAMENTO — 4 DADOS, UM POR VEZ ━━━
Só peça dados quando o cliente confirmou que quer comprar. Nunca peça tudo de uma vez.

ORDEM dos dados (pule os que já tiver):
1. LOCALIZAÇÃO — "me manda sua localização 📍"
   → Se receber "[Localização recebida]" OU link do Maps OU texto com rua/bairro/CEP: ✅ já tem localização, não peça de novo
   → Só peça endereço por escrito SE a localização não vier com texto claro
2. HORÁRIO — "até que horas vc pode receber?"
3. PAGAMENTO — "prefere dinheiro, pix ou cartão? (no cartão aceita até 10x)"
4. NOME — "me fala o nome de quem vai receber?"

Com todos os 4 dados: emita [PASSAGEM] no JSON E diga ao cliente: "perfeito, pedido encaminhado! 🙌"

[PASSAGEM]{"endereco":"...","localizacao":"...","pagamento":"...","horario":"...","nome":"...","produto":"..."}

━━━ RECONHECIMENTO DE LOCALIZAÇÃO ━━━
Considere como localização recebida QUALQUER um desses:
- Mensagem contendo "[Localização recebida]" (pin nativo do WhatsApp)
- Link maps.google.com, goo.gl/maps ou similar
- Texto com rua, avenida, bairro, CEP, setor, quadra, número
Se já tem localização: NÃO peça de novo. Use o que o cliente enviou.

━━━ NUNCA FAÇA ━━━
- Perguntar algo que o cliente já respondeu
- Pedir endereço + CEP + telefone tudo numa mensagem
- Apresentar 2+ produtos ao mesmo tempo
- Perguntar "posso te ajudar em algo mais?"
- Repetir o que o cliente falou
- Escrever mensagens longas

━━━ ESCALADA PARA HUMANO — use [ESCALAR] em qualquer desses casos ━━━
1. Cliente pede explicitamente: "falar com humano", "falar com pessoa", "falar com o Pedro", "falar com o dono", "falar com atendente", "quero falar com alguém"
2. Cliente demonstra raiva ou frustração intensa: "absurdo", "ridículo", "péssimo atendimento", "vou reclamar", "me enganaram", "não voltarei mais", muitas exclamações/caps
3. Cliente relata problema com pedido anterior: "meu produto veio errado", "não entregaram", "produto com defeito", "quero cancelar", "quero devolver", "quero reembolso"
4. Dúvida técnica muito específica que você não sabe responder após 2 tentativas
5. Cliente ameaça ou xinga
6. A mesma objeção se repete 3+ vezes sem evolução (ex: cliente continua falando em preço depois de 3 respostas suas sobre isso)
7. Conversa passou de 20 mensagens sem chegar ao fechamento

Quando usar [ESCALAR]:
- Não desapareça abruptamente. Diga: "deixa eu chamar o Pedro aqui, ele vai te ajudar melhor nessa 👊"
- Emita [ESCALAR] no JSON junto com essa mensagem

━━━ FLAGS ━━━
[OPT_OUT] — cliente pediu pra não ser contactado
[FOTO_SLUG] — envia foto(s) do produto (substitua SLUG pelo slug do produto)
[VIDEO_SLUG] — envia vídeo do produto (substitua SLUG pelo slug do produto)
[ESCALAR] — escalar para humano (ver criterios acima)`;

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
    const runtimeCtx = buildRuntimeContext(leadState, msgCount, isFirstInteraction, aiConfig, collectedData);
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
