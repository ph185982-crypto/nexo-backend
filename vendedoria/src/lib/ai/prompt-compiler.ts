// Compila o prompt final em 5 camadas: Persona → Estratégia → Restrições → Objeções → Histórico.
// Substitui buildRuntimeContext() monolítico do agent.ts.

export interface AiConfigLayer {
  usarEmoji: boolean;
  usarReticencias: boolean;
  nivelVenda: string; // leve | medio | agressivo
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

  // Camada 3 — Restrições
  collectedData: CollectedDataLayer;

  // Camada 4 — Objeções
  recentMessages: Array<{ role: string; content: string }>;

  // Camada 5 — Histórico / Runtime
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
    historico: string;
  };
}

const NIVEL_INSTRUCTIONS: Record<string, string> = {
  leve:      "Responda e deixe o cliente conduzir.",
  medio:     "Conduza naturalmente. Após responder, avance um passo.",
  agressivo: "Conduza ativamente. Use urgência com naturalidade.",
};

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
    ? `- Inclua IMEDIATAMENTE os flags de mídia do produto identificado (flags disponíveis: ${mediaFlags})\n- ATENÇÃO: coloque o flag exato em um balão separado — isso dispara o envio. Nunca diga "vou te enviar fotos" sem o flag.`
    : "";

  return [
    `--- ESTRATÉGIA ---`,
    `Hora SP: ${hour}h (${greeting}) | ${dentroExpediente ? "✅ Expediente aberto" : "🔴 Fora do expediente"}`,
    `Entrega: ${entregaHoje}`,
    `Emoji: ${emoji ? "SIM (máx 1/msg, não em toda msg)" : "NÃO"} | Nível de venda: ${NIVEL_INSTRUCTIONS[nivel] ?? NIVEL_INSTRUCTIONS.medio}`,
    firstContactInstr,
    `--- FIM ESTRATÉGIA ---`,
  ].filter(Boolean).join("\n");
}

// ── Camada 3: Restrições ──────────────────────────────────────────────────────
function buildRestricoesLayer(data: CollectedDataLayer): string {
  const itens: string[] = [];
  if (data.localizacao) itens.push(`✅ LOCALIZAÇÃO RECEBIDA: "${data.localizacao.substring(0, 100)}" — PROIBIDO pedir localização de novo`);
  if (data.endereco && data.endereco !== data.localizacao) itens.push(`✅ Endereço: ${data.endereco.substring(0, 80)}`);
  if (data.pagamento)  itens.push(`✅ Pagamento: ${data.pagamento}`);
  if (data.horario)    itens.push(`✅ Horário: ${data.horario}`);
  if (data.nome)       itens.push(`✅ Nome: ${data.nome}`);

  if (itens.length === 0) return "";

  return [
    `--- RESTRIÇÕES — DADOS JÁ COLETADOS (NÃO PERGUNTAR DE NOVO) ---`,
    ...itens,
    `--- FIM RESTRIÇÕES ---`,
  ].join("\n");
}

// ── Camada 4: Objeções ────────────────────────────────────────────────────────
function buildObjecoesLayer(recentMessages: Array<{ role: string; content: string }>): string {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "?");

  const clientPriceObj = recentMessages.filter(
    (m) => m.role === "USER" && /\b(caro|muito\s+caro|caro\s+demais|ta\s+caro|sem\s+dinheiro|nao\s+tenho\s+dinheiro|preco\s+alto|nao\s+tenho\s+grana)\b/.test(normalize(m.content))
  );

  if (clientPriceObj.length === 0) return "";

  const aiPriceAttempts = recentMessages.filter(
    (m) => m.role === "ASSISTANT" && /\b(parcela|cartao|10x|garantia|risco|paga\s+na\s+entrega|paga\s+so\s+quando|ferragem|loja|estoque|acabando)\b/.test(normalize(m.content))
  ).length;

  const attempts = Math.min(aiPriceAttempts, 5);
  const remaining = 5 - attempts;

  return [
    `--- OBJEÇÕES ---`,
    `OBJEÇÃO DE PREÇO detectada. Tentativas de quebra realizadas: ${attempts}.`,
    remaining > 0
      ? `Ainda tem ${remaining} tentativa(s). Varie o argumento (parcela → risco zero → comparação → urgência → kit).`
      : `Já tentou bastante. Tente ângulo diferente — benefício, praticidade, entrega. NUNCA escale por preço.`,
    `--- FIM OBJEÇÕES ---`,
  ].join("\n");
}

// ── Camada 5: Histórico / Runtime ─────────────────────────────────────────────
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
      etapaInstr = `ETAPA 4 — FECHAR PEDIDO: você tem todos os dados. Emita [PASSAGEM] com os dados e confirme ao cliente: "perfeito, pedido encaminhado! 🙌"`;
    } else {
      etapaInstr = `ETAPA 4 — COLETAR DADOS (lead confirmou compra):
Dado que falta agora (1 por vez): ${falta[0]}
${falta.length > 1 ? `(depois ainda faltará: ${falta.slice(1).join(", ")})` : ""}
${entregaHoje}
NÃO repita dados já coletados.`;
    }
  } else if (messageCount <= 4 || leadState.tipo === "curioso") {
    etapaInstr = `ETAPA 2 — QUALIFICAR E APRESENTAR:
- Se ainda não enviou mídia: inclua [FOTO_SLUG] e [VIDEO_SLUG] agora
- Entenda o uso do produto (faça 1 pergunta)
- Apresente 1-2 diferenciais relevantes
- NÃO peça localização`;
  } else if (leadState.tipo === "interessado" || messageCount <= 8) {
    etapaInstr = `ETAPA 3 — CONVERTER:
- Reforce "só paga quando chegar na sua mão, sem risco"
- Use prova social: "aqui em Goiânia tô mandando bastante essa semana"
- Pergunte diretamente: "posso separar uma pra você?"
- Se ainda não enviou vídeo: inclua [VIDEO_SLUG] agora
- NÃO peça localização ainda`;
  } else if (leadState.tipo === "frio") {
    etapaInstr = `ETAPA 3 — REENGAJAR:
- Use escassez natural: "essa tá acabando"
- Remova objeção de preço: "e você só paga na entrega, sem risco"
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
    `• delays em ms entre balões (600-2000ms, simule digitação humana)`,
    `• Flags de mídia: [FOTO_SLUG] ou [VIDEO_SLUG] sozinhos no array (substitua SLUG pelo slug do produto)`,
    `• Sem "Claro!" "Ótimo!" "Entendido!" "Prezado" "Conforme" — fale como pessoa real`,
    `--- FIM HISTÓRICO ---`,
  ].filter(Boolean).join("\n");
}

// ── API pública ───────────────────────────────────────────────────────────────
export class PromptCompiler {
  compile(input: PromptCompilerInput): CompiledPrompt {
    const persona     = input.basePersonaPrompt;
    const estrategia  = buildEstrategiaLayer(input.aiConfig, input.activeProducts, input.businessHours, input.isFirstInteraction);
    const restricoes  = buildRestricoesLayer(input.collectedData);
    const objecoes    = buildObjecoesLayer(input.recentMessages);
    const historico   = buildHistoricoLayer(
      input.leadState,
      input.messageCount,
      input.isFirstInteraction,
      input.etapa,
      input.collectedData,
      input.businessHours,
      input.activeProducts,
    );

    const parts = [persona, estrategia, restricoes, objecoes, historico].filter(Boolean);
    const systemPrompt = parts.join("\n\n");

    return { systemPrompt, layers: { persona, estrategia, restricoes, objecoes, historico } };
  }
}

export const promptCompiler = new PromptCompiler();
