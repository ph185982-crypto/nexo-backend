// Compila o prompt final em 6 camadas:
// Persona → Estratégia → Restrições (coletadas + configuradas) → Objeções → Catálogo → Histórico

import type { ProductContext } from "@/lib/ai/product-sourcing";

export interface ObjecaoEntry {
  palavraChave: string;
  estrategia: string;
  exemplo: string;
}

export interface AiConfigLayer {
  usarEmoji: boolean;
  usarReticencias: boolean;
  nivelVenda: string;             // leve | medio | agressivo
  tomDeVoz?: string;              // sincero | agressivo | consultivo
  arquetipoIA?: string | null;
  objetivoVenda?: string;         // fechar_venda | gerar_lead | qualificar
  nivelUrgencia?: number;         // 1-5
  matrizObjecoes?: ObjecaoEntry[];
  restricoes?: string[];
  followUpIntervalos?: number[];
  followUpMaxTentativas?: number;
}

export interface CollectedDataLayer {
  localizacao?: string;
  endereco?: string;
  pagamento?: string;
  horario?: string;
  nome?: string;
}

export interface ProductRef {
  id: string;
  name: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}

export interface PromptCompilerInput {
  // Camada 1 — Persona
  basePersonaPrompt: string;

  // Camada 2 — Estratégia
  aiConfig: AiConfigLayer | null;
  activeProducts: ProductRef[];
  businessHours: { hour: number; dayOfWeek: number };

  // Camada 3 — Restrições (dados coletados)
  collectedData: CollectedDataLayer;

  // Camada 4 — Objeções
  recentMessages: Array<{ role: string; content: string }>;

  // Camada 5 — Catálogo dinâmico (detectado pelo ProductSourcingService)
  detectedProducts?: ProductContext[];

  // Camada 6 — Histórico / Runtime
  leadState: { tipo: string; urgencia: string };
  messageCount: number;
  isFirstInteraction: boolean;
  etapa: string;
}

export interface CompiledPrompt {
  systemPrompt: string;
  layers: {
    persona: string;
    estrategia: string;
    restricoes: string;
    objecoes: string;
    catalogo: string;
    historico: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NIVEL_INSTRUCTIONS: Record<string, string> = {
  leve:      "Responda e deixe o cliente conduzir.",
  medio:     "Conduza naturalmente. Após responder, avance um passo.",
  agressivo: "Conduza ativamente. Use urgência com naturalidade.",
};

const TOM_INSTRUCTIONS: Record<string, string> = {
  sincero:    "Seja autêntico e transparente. Mostre que você acredita no produto.",
  agressivo:  "Vá direto ao fechamento. Crie urgência real. Seja assertivo.",
  consultivo: "Faça perguntas. Entenda a necessidade. Recomende com base no perfil do cliente.",
};

const OBJETIVO_INSTRUCTIONS: Record<string, string> = {
  fechar_venda:  "Seu único objetivo é fechar o pedido nesta conversa.",
  gerar_lead:    "Colete nome + telefone + horário disponível para visita.",
  qualificar:    "Identifique se o cliente tem perfil de compra antes de investir mais esforço.",
};

const URGENCIA_LABELS = ["", "Muito suave (apenas responder)", "Suave", "Moderada", "Alta", "Máxima (fechar agora)"];

function getSaoPauloGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "bom dia";
  if (hour >= 12 && hour < 18) return "boa tarde";
  return "boa noite";
}

function isBusinessHours(hour: number, dayOfWeek: number): boolean {
  if (dayOfWeek >= 1 && dayOfWeek <= 5) return hour >= 9 && hour < 18;
  if (dayOfWeek === 6) return hour >= 8 && hour < 13;
  return false;
}

// ── Camada 2: Estratégia ──────────────────────────────────────────────────────
function buildEstrategiaLayer(
  aiConfig: AiConfigLayer | null,
  activeProducts: ProductRef[],
  businessHours: { hour: number; dayOfWeek: number },
  isFirstInteraction: boolean,
): string {
  const { hour, dayOfWeek } = businessHours;
  const greeting = getSaoPauloGreeting(hour);
  const dentroExpediente = isBusinessHours(hour, dayOfWeek);
  const nivel = aiConfig?.nivelVenda ?? "medio";
  const emoji = aiConfig?.usarEmoji !== false;
  const tomDeVoz = aiConfig?.tomDeVoz ?? "sincero";
  const objetivo = aiConfig?.objetivoVenda ?? "fechar_venda";
  const urgencia = aiConfig?.nivelUrgencia ?? 3;
  const arquetipo = aiConfig?.arquetipoIA;

  const entregaHoje = dentroExpediente
    ? "entrega pode ser HOJE — confirmar horário com o cliente"
    : "fora do expediente (seg-sex 9-18h, sáb 8-13h) — ofereça agendar para o próximo dia útil";

  const mediaFlags = activeProducts
    .filter((p) => p.imageUrl || p.videoUrl)
    .map((p) => {
      const s = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      return `[FOTO_${s}]${p.videoUrl ? ` e [VIDEO_${s}]` : ""}`;
    })
    .join("  |  ");

  const firstContactInstr = isFirstInteraction && mediaFlags
    ? `- Inclua IMEDIATAMENTE os flags de mídia do produto identificado (flags disponíveis: ${mediaFlags})\n- ATENÇÃO: coloque o flag exato em um balão separado — isso dispara o envio.`
    : "";

  return [
    `--- ESTRATÉGIA ---`,
    `Hora SP: ${hour}h (${greeting}) | ${dentroExpediente ? "✅ Expediente" : "🔴 Fora do expediente"}`,
    `Entrega: ${entregaHoje}`,
    `Emoji: ${emoji ? "SIM (máx 1/msg)" : "NÃO"} | Nível de venda: ${NIVEL_INSTRUCTIONS[nivel] ?? NIVEL_INSTRUCTIONS.medio}`,
    `Tom de voz: ${TOM_INSTRUCTIONS[tomDeVoz] ?? TOM_INSTRUCTIONS.sincero}`,
    `Objetivo: ${OBJETIVO_INSTRUCTIONS[objetivo] ?? OBJETIVO_INSTRUCTIONS.fechar_venda}`,
    `Urgência: ${URGENCIA_LABELS[urgencia] ?? "Moderada"}`,
    arquetipo ? `Arquétipo: ${arquetipo}` : "",
    firstContactInstr,
    `--- FIM ESTRATÉGIA ---`,
  ].filter(Boolean).join("\n");
}

// ── Camada 3a: Restrições — dados coletados ───────────────────────────────────
function buildRestricoesColetadasLayer(data: CollectedDataLayer): string {
  const itens: string[] = [];
  if (data.localizacao) itens.push(`✅ LOCALIZAÇÃO RECEBIDA: "${data.localizacao.substring(0, 100)}" — PROIBIDO pedir de novo`);
  if (data.endereco && data.endereco !== data.localizacao) itens.push(`✅ Endereço: ${data.endereco.substring(0, 80)}`);
  if (data.pagamento)  itens.push(`✅ Pagamento: ${data.pagamento}`);
  if (data.horario)    itens.push(`✅ Horário: ${data.horario}`);
  if (data.nome)       itens.push(`✅ Nome: ${data.nome}`);
  if (itens.length === 0) return "";
  return [
    `--- DADOS JÁ COLETADOS (NÃO PERGUNTAR DE NOVO) ---`,
    ...itens,
    `--- FIM DADOS ---`,
  ].join("\n");
}

// ── Camada 3b: Restrições — configuradas pelo usuário ─────────────────────────
function buildRestricoesConfigLayer(restricoes: string[]): string {
  if (!restricoes.length) return "";
  return [
    `--- RESTRIÇÕES ABSOLUTAS (NUNCA FAÇA) ---`,
    ...restricoes.map((r, i) => `${i + 1}. ${r}`),
    `--- FIM RESTRIÇÕES ---`,
  ].join("\n");
}

// ── Camada 4: Objeções ────────────────────────────────────────────────────────
function buildObjecoesLayer(
  recentMessages: Array<{ role: string; content: string }>,
  customMatrix?: ObjecaoEntry[],
): string {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");

  const lines: string[] = [];

  // Custom objection matrix from command center
  if (customMatrix && customMatrix.length > 0) {
    lines.push(`--- MATRIZ DE OBJEÇÕES PERSONALIZADA ---`);
    for (const entry of customMatrix) {
      lines.push(`• "${entry.palavraChave}" → ${entry.estrategia}`);
      if (entry.exemplo) lines.push(`  Exemplo: ${entry.exemplo}`);
    }
    lines.push(`--- FIM MATRIZ ---`);
    lines.push("");
  }

  // Auto-detected price objection tracking
  const clientPriceObj = recentMessages.filter(
    (m) =>
      m.role === "USER" &&
      /\b(caro|muito\s+caro|caro\s+demais|ta\s+caro|sem\s+dinheiro|nao\s+tenho\s+dinheiro|preco\s+alto|nao\s+tenho\s+grana)\b/.test(
        normalize(m.content)
      )
  );

  if (clientPriceObj.length > 0) {
    const aiPriceAttempts = recentMessages.filter(
      (m) =>
        m.role === "ASSISTANT" &&
        /\b(parcela|cartao|10x|garantia|risco|paga\s+na\s+entrega|paga\s+so\s+quando|ferragem|loja|estoque|acabando)\b/.test(
          normalize(m.content)
        )
    ).length;
    const attempts = Math.min(aiPriceAttempts, 5);
    const remaining = 5 - attempts;
    lines.push(`--- OBJEÇÃO DE PREÇO ---`);
    lines.push(`Tentativas de quebra: ${attempts}.`);
    lines.push(
      remaining > 0
        ? `Ainda tem ${remaining} tentativa(s). Varie: parcela → risco zero → comparação → urgência → kit.`
        : `Já tentou bastante. Tente benefício/praticidade. NUNCA escale por preço.`
    );
    lines.push(`--- FIM OBJEÇÃO ---`);
  }

  return lines.join("\n");
}

// ── Camada 5: Catálogo dinâmico ───────────────────────────────────────────────
function buildCatalogoLayer(products: ProductContext[]): string {
  if (!products.length) return "";

  const blocks = products.map((p) => {
    const price = `R$ ${p.price.toFixed(2).replace(".", ",")}`;
    const installStr =
      p.priceInstallments && p.priceInstallments > 0
        ? `${p.installments}x de R$ ${p.priceInstallments.toFixed(2).replace(".", ",")}`
        : "";
    const hasImgs = p.imageUrls.length > 0 || !!p.imageUrl;
    return [
      `📦 ${p.name}`,
      `💰 À vista: ${price}`,
      installStr ? `💳 Parcelado: ${installStr}` : "",
      p.description ? `📝 ${p.description.slice(0, 180)}` : "",
      hasImgs ? `→ Fotos: use [FOTO_${p.slug}] em balão separado` : "",
      p.videoUrl ? `→ Vídeo: use [VIDEO_${p.slug}] em balão separado` : "",
      `⚠️ CRÍTICO: use EXATAMENTE este preço. NUNCA invente valores.`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `--- CATÁLOGO REAL — DADOS EXATOS DO BANCO ---`,
    ...blocks,
    `--- FIM CATÁLOGO ---`,
  ].join("\n\n");
}

// ── Camada 6: Histórico / Runtime ─────────────────────────────────────────────
function buildHistoricoLayer(
  leadState: { tipo: string; urgencia: string },
  messageCount: number,
  isFirstInteraction: boolean,
  etapa: string,
  collectedData: CollectedDataLayer,
  businessHours: { hour: number; dayOfWeek: number },
  activeProducts: ProductRef[],
): string {
  const { hour, dayOfWeek } = businessHours;
  const dentroExpediente = isBusinessHours(hour, dayOfWeek);
  const greeting = getSaoPauloGreeting(hour);
  const entregaHoje = dentroExpediente
    ? "entrega pode ser HOJE — confirmar horário com o cliente"
    : "fora do expediente — ofereça agendar para o próximo dia útil";

  let etapaInstr: string;

  if (isFirstInteraction) {
    const mediaFlags = activeProducts
      .filter((p) => p.imageUrl || p.videoUrl)
      .map((p) => {
        const s = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        return `[FOTO_${s}]${p.videoUrl ? ` e [VIDEO_${s}]` : ""}`;
      })
      .join("  |  ");

    etapaInstr = `ETAPA 1 — PRIMEIRO CONTATO:
- Identifique o produto pela mensagem ("21v"/"bomvink" = Bomvink 21V; "48v"/"luatek" = Luatek 48V)
- Cumprimente com "${greeting}" em 1 balão, apresente-se como Léo da Nexo em outro
${mediaFlags ? `- Flags de mídia disponíveis: ${mediaFlags}` : "- Descreva o produto em texto"}
- 2 benefícios curtos em balões separados
- 1 pergunta de qualificação
- NÃO peça localização agora`;
  } else if (leadState.tipo === "quente") {
    const temLocal = !!(collectedData.localizacao || collectedData.endereco);
    const falta: string[] = [];
    if (!temLocal)                falta.push("localização (pin 📍 ou texto: rua, bairro, CEP)");
    if (!collectedData.horario)   falta.push("até que horas pode receber");
    if (!collectedData.pagamento) falta.push("forma de pagamento (dinheiro, pix ou cartão)");
    if (!collectedData.nome)      falta.push("nome de quem vai receber");

    if (falta.length === 0) {
      etapaInstr = `ETAPA 4 — FECHAR PEDIDO: você tem todos os dados. Emita [PASSAGEM] com os dados.`;
    } else {
      etapaInstr = `ETAPA 4 — COLETAR DADOS (lead confirmou compra):
Dado que falta agora (1 por vez): ${falta[0]}
${falta.length > 1 ? `(depois ainda faltará: ${falta.slice(1).join(", ")})` : ""}
${entregaHoje}
NÃO repita dados já coletados.`;
    }
  } else if (messageCount <= 4 || leadState.tipo === "curioso") {
    etapaInstr = `ETAPA 2 — QUALIFICAR E APRESENTAR:
- Se ainda não enviou mídia: inclua [FOTO_SLUG] agora
- Entenda o uso do produto (faça 1 pergunta)
- Apresente 1-2 diferenciais relevantes
- NÃO peça localização`;
  } else if (leadState.tipo === "interessado" || messageCount <= 8) {
    etapaInstr = `ETAPA 3 — CONVERTER:
- Reforce "só paga quando chegar na sua mão, sem risco"
- Pergunte diretamente: "posso separar uma pra você?"
- Se ainda não enviou vídeo: inclua [VIDEO_SLUG] agora
- NÃO peça localização ainda`;
  } else if (leadState.tipo === "frio") {
    etapaInstr = `ETAPA 3 — REENGAJAR:
- Use escassez natural: "essa tá acabando"
- Remova objeção: "você só paga na entrega, sem risco"
- Inclua [FOTO_SLUG] se ainda não enviou`;
  } else {
    etapaInstr = `ETAPA 3 — AVANÇAR: responda a dúvida e empurre suavemente para o fechamento.`;
  }

  return [
    `--- HISTÓRICO / RUNTIME ---`,
    `Lead: ${leadState.tipo} | Urgência: ${leadState.urgencia} | Msgs: ${messageCount} | 1ª vez: ${isFirstInteraction ? "SIM" : "NÃO"} | Etapa DB: ${etapa}`,
    ``,
    etapaInstr,
    ``,
    `FORMATO OBRIGATÓRIO — responda SEMPRE em JSON:`,
    `{"mensagens": ["balão 1", "balão 2", "[FOTO_SLUG]", "balão 3"], "delays": [0, 1200, 600, 1500]}`,
    `• Cada balão = 1 frase curta (1-2 linhas)`,
    `• delays em ms entre balões (600-2000ms)`,
    `• Flags de mídia: [FOTO_SLUG] ou [VIDEO_SLUG] sozinhos no array`,
    `• Sem "Claro!" "Ótimo!" "Entendido!" — fale como pessoa real`,
    `--- FIM HISTÓRICO ---`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── API pública ───────────────────────────────────────────────────────────────
export class PromptCompiler {
  compile(input: PromptCompilerInput): CompiledPrompt {
    const persona    = input.basePersonaPrompt;
    const estrategia = buildEstrategiaLayer(input.aiConfig, input.activeProducts, input.businessHours, input.isFirstInteraction);
    const restricoes = [
      buildRestricoesColetadasLayer(input.collectedData),
      buildRestricoesConfigLayer(input.aiConfig?.restricoes ?? []),
    ].filter(Boolean).join("\n\n");
    const objecoes   = buildObjecoesLayer(input.recentMessages, input.aiConfig?.matrizObjecoes);
    const catalogo   = buildCatalogoLayer(input.detectedProducts ?? []);
    const historico  = buildHistoricoLayer(
      input.leadState,
      input.messageCount,
      input.isFirstInteraction,
      input.etapa,
      input.collectedData,
      input.businessHours,
      input.activeProducts,
    );

    const parts = [persona, estrategia, restricoes, objecoes, catalogo, historico].filter(Boolean);
    const systemPrompt = parts.join("\n\n");

    return { systemPrompt, layers: { persona, estrategia, restricoes, objecoes, catalogo, historico } };
  }
}

export const promptCompiler = new PromptCompiler();

// ─── compilePrompt: functional adapter used by orchestrator.ts ────────────────
export async function compilePrompt(
  _conversationId: string,
  _history: Array<{ role: string; content: string; timestamp?: Date }>,
  _opts: { action: string },
): Promise<CompiledPrompt> {
  return {
    systemPrompt: "",
    layers: { persona: "", estrategia: "", restricoes: "", objecoes: "", catalogo: "", historico: "" },
  };
}
