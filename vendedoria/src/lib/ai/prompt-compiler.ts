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
  nivelVenda: string;
  tomDeVoz?: string;
  arquetipoIA?: string | null;
  objetivoVenda?: string;
  nivelUrgencia?: number;
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
  cep?: string;
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
  leadState: { tipo: string; urgencia: string } | null;
  messageCount: number;
  isFirstInteraction: boolean;
  etapa: string;

  // Modo prospecção B2B
  organizationTipo?: string; // VENDAS | PROSPECCAO
  slotsDisponiveis?: Array<{ label: string }>; // horários disponíveis para reunião
  sessaoProspeccao?: {
    tipoNegocio?: string;
    urgencia?: string;
    dataHoraPreferida?: string;
    sinalOportunidade?: string;
    nomeContato?: string;
    empresaNome?: string;
  };
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

// ── Helpers ──────────────────────────────────────────────────────────────────────────────

const NIVEL_INSTRUCTIONS: Record<string, string> = {
  leve:      "Responda e deixe o cliente conduzir.",
  medio:     "Conduza naturalmente. Após responder, avançe um passo.",
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

// ── Camada 2: Estratégia ──────────────────────────────────────────────────────────
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

// ── Camada 3a: Restrições — dados coletados ───────────────────────────────────────────
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

// ── Camada 3b: Restrições — configuradas pelo usuário ───────────────────────────────────
function buildRestricoesConfigLayer(restricoes: string[]): string {
  if (!restricoes.length) return "";
  return [
    `--- RESTRIÇÕES ABSOLUTAS (NUNCA FAÇA) ---`,
    ...restricoes.map((r, i) => `${i + 1}. ${r}`),
    `--- FIM RESTRIÇÕES ---`,
  ].join("\n");
}

// ── Camada 4: Objeções ────────────────────────────────────────────────────────────────
function buildObjecoesLayer(
  recentMessages: Array<{ role: string; content: string }>,
  customMatrix?: ObjecaoEntry[],
): string {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");

  const lines: string[] = [];

  if (customMatrix && customMatrix.length > 0) {
    lines.push(`--- MATRIZ DE OBJEÇÕES PERSONALIZADA ---`);
    for (const entry of customMatrix) {
      lines.push(`• "${entry.palavraChave}" → ${entry.estrategia}`);
      if (entry.exemplo) lines.push(`  Exemplo: ${entry.exemplo}`);
    }
    lines.push(`--- FIM MATRIZ ---`);
    lines.push("");
  }

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

// ── Camada 5 Prospecção: Calendário (substitui Catálogo para orgs PROSPECCAO) ────────────
function buildCalendarioLayer(
  slots: Array<{ label: string }>,
  sessao?: {
    tipoNegocio?: string;
    urgencia?: string;
    dataHoraPreferida?: string;
    sinalOportunidade?: string;
    nomeContato?: string;
    empresaNome?: string;
  },
): string {
  const linhas: string[] = [
    `--- AGENDA — HORÁRIOS DISPONÍVEIS PARA REUNIÃO ---`,
  ];

  if (slots.length > 0) {
    linhas.push(`Ofereça ao cliente UM DESTES horários (não todos de vez):`);
    slots.slice(0, 5).forEach((s, i) => linhas.push(`  ${i + 1}. ${s.label}`));
  } else {
    linhas.push(`Nenhum slot pré-carregado — pergunte a disponibilidade do cliente.`);
  }

  if (sessao) {
    const itens: string[] = [];
    if (sessao.tipoNegocio)        itens.push(`Tipo de negócio: ${sessao.tipoNegocio}`);
    if (sessao.empresaNome)        itens.push(`Empresa: ${sessao.empresaNome}`);
    if (sessao.nomeContato)        itens.push(`Contato: ${sessao.nomeContato}`);
    if (sessao.urgencia)           itens.push(`Urgência: ${sessao.urgencia}`);
    if (sessao.sinalOportunidade)  itens.push(`Sinal de oportunidade: ${sessao.sinalOportunidade}`);
    if (sessao.dataHoraPreferida)  itens.push(`Preferência do cliente: ${sessao.dataHoraPreferida}`);
    if (itens.length > 0) {
      linhas.push(``, `Dados já coletados (NÃO perguntar de novo):`);
      itens.forEach((it) => linhas.push(`✅ ${it}`));
    }
  }

  linhas.push(
    ``,
    `Quando o cliente confirmar data e hora, emita [REUNIAO_AGENDADA] no array JSON.`,
    `--- FIM AGENDA ---`,
  );

  return linhas.join("\n");
}

// ── Camada 5: Catálogo dinâmico ────────────────────────────────────────────────────────
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

// ── Camada 6: Runtime ───────────────────────────────────────────────────────────────────
function buildHistoricoLayer(
  leadState: { tipo: string; urgencia: string } | null,
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

  const mediaFlags = activeProducts
    .filter((p) => p.imageUrl || p.videoUrl)
    .map((p) => {
      const s = p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      return `[FOTO_${s}]${p.videoUrl ? ` / [VIDEO_${s}]` : ""}`;
    })
    .join("  |  ");

  const isNacional = !!(collectedData.cep);
  const faltaLinhas: string[] = [];
  if (leadState?.tipo === "quente") {
    if (isNacional) {
      // Endereço completo = deve ter mais que só o CEP
      const temEnderecoCompleto = !!(collectedData.endereco && collectedData.endereco !== collectedData.cep && collectedData.endereco.length > 10);
      if (!temEnderecoCompleto)     faltaLinhas.push("endereço completo (rua, número, complemento)");
      if (!collectedData.nome)      faltaLinhas.push("nome completo de quem vai receber");
      // pagamento não é coletado aqui — o cliente escolhe no link de checkout
    } else {
      const temLocal = !!(collectedData.localizacao || collectedData.endereco);
      if (!temLocal)                faltaLinhas.push("localização");
      if (!collectedData.horario)   faltaLinhas.push("horário para receber");
      if (!collectedData.pagamento) faltaLinhas.push("forma de pagamento");
      if (!collectedData.nome)      faltaLinhas.push("nome do recebedor");
    }
  }

  const allCollectedAction = isNacional
    ? `✅ Todos os dados coletados — emita [CHECKOUT] no array JSON para gerar o link de pagamento.`
    : `✅ Todos os dados coletados — emita [PASSAGEM] com os dados.`;

  const modoEntregaBlock = isNacional
    ? `MODO NACIONAL: Frete grátis — não mencionar frete.\nDados coletados até agora: CEP ✅${collectedData.endereco && collectedData.endereco !== collectedData.cep ? " → endereço ✅" : " → endereço ⏳"}\nColetar em ordem: endereço completo → nome → [CHECKOUT] (pagamento via link gerado automaticamente)`
    : `ENTREGAS:\n• Goiânia/GO: pedir localização (pin ou endereço) + horário + pagamento + nome → [PASSAGEM]\n• Outras cidades (SP, RJ, BH...): pedir CEP + endereço completo + nome → [CHECKOUT]`;

  return [
    `--- CONTEXTO RUNTIME (não muda o script, apenas informa o estado atual) ---`,
    `Hora SP: ${hour}h — saudação: "${greeting}" | ${dentroExpediente ? "✅ dentro do expediente" : "🔴 fora do expediente (seg-sex 9-18h, sáb 8-13h)"}`,
    `Lead: ${leadState?.tipo ?? "desconhecido"} | Urgência: ${leadState?.urgencia ?? "normal"} | Mensagens trocadas: ${messageCount} | Primeiro contato: ${isFirstInteraction ? "SIM" : "NÃO"} | Etapa DB: ${etapa}`,
    mediaFlags ? `Flags de mídia disponíveis: ${mediaFlags}` : "",
    modoEntregaBlock,
    faltaLinhas.length > 0
      ? `⚠️ Lead quente — dados ainda faltando (colete 1 por vez): ${faltaLinhas.join(" → ")}`
      : faltaLinhas.length === 0 && leadState?.tipo === "quente"
        ? allCollectedAction
        : "",
    `--- FIM CONTEXTO ---`,
    ``,
    `FORMATO OBRIGATÓRIO — responda SEMPRE em JSON válido:`,
    `{"mensagens": ["balão 1", "balão 2", "[FOTO_SLUG]", "balão 3"], "delays": [0, 1200, 600, 1500]}`,
    `• Cada balão = 1 frase curta (máx 2 linhas) | delays em ms (600–2000ms)`,
    `• MÍDIA: se vai enviar foto/vídeo, coloque [FOTO_SLUG] ou [VIDEO_SLUG] sozinhos no array. NUNCA prometa "vou mandar foto" sem incluir a flag. A flag substitui o texto — não diga "estou enviando" junto.`,
    `• PALAVRAS PROIBIDAS: "show!", "ótimo!", "perfeito!", "incrível!", "super!", "certamente", "claro!", "entendido!", "prezado" — fale como pessoa real em conversa`,
    `• CHECKOUT (nacional): quando o cliente de outra cidade confirmar a compra e você tiver CEP + endereço + nome, emita [CHECKOUT] no array. O sistema gera e envia automaticamente um link de pagamento onde o cliente escolhe Pix ou parcelado. NUNCA escreva chave Pix, CPF, e-mail ou link no texto.`,
    `• FORMAS ACEITAS: Pix (à vista) | Cartão de crédito parcelado em até 10x | Dinheiro (só Goiânia, na entrega)`,
    `--- FIM FORMATO ---`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── API pública ──────────────────────────────────────────────────────────────────────────────
export class PromptCompiler {
  compile(input: PromptCompilerInput): CompiledPrompt {
    const persona    = input.basePersonaPrompt;
    const estrategia = buildEstrategiaLayer(input.aiConfig, input.activeProducts, input.businessHours, input.isFirstInteraction);
    const restricoes = [
      buildRestricoesColetadasLayer(input.collectedData),
      buildRestricoesConfigLayer(input.aiConfig?.restricoes ?? []),
    ].filter(Boolean).join("\n\n");
    const objecoes   = buildObjecoesLayer(input.recentMessages, input.aiConfig?.matrizObjecoes);

    const isProspeccao = input.organizationTipo === "PROSPECCAO";
    const catalogo = isProspeccao
      ? buildCalendarioLayer(input.slotsDisponiveis ?? [], input.sessaoProspeccao)
      : buildCatalogoLayer(input.detectedProducts ?? []);

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

// Async helper used by orchestrator / responder
export async function compilePrompt(
  _conversationId: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  _options?: { action?: string },
): Promise<CompiledPrompt> {
  const { prisma } = await import("@/lib/prisma/client");
  const config = await prisma.agentConfig.findFirst();
  return promptCompiler.compile({
    basePersonaPrompt: config?.currentPrompt ?? "",
    aiConfig: null,
    activeProducts: [],
    businessHours: { hour: new Date().getHours(), dayOfWeek: new Date().getDay() },
    collectedData: {},
    recentMessages: history,
    leadState: null,
    messageCount: history.length,
    isFirstInteraction: history.length <= 1,
    etapa: "NOVO",
    detectedProducts: [],
  });
}
