// Gemini (Google) para o que a DeepSeek não faz: ouvir áudio, ler imagem e buscar na web.
// Usa uma chave de API do Google AI Studio na variável de ambiente GOOGLE_AI_API_KEY
// (plano gratuito basta para o volume do sistema). NÃO é o "ID do cliente OAuth"/"chave
// secreta GOCSPX": esses servem para login com Google, não para chamar o Gemini.
// A chave vai no cabeçalho x-goog-api-key (nunca na URL, que acaba em log).
//
// Plano gratuito: o Google pode usar o conteúdo enviado para melhorar os produtos dele.

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_PADRAO_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20000);

/** Modelo rápido e com plano gratuito. Se o Google aposentar este, troque em GEMINI_MODEL. */
export const GEMINI_MODELO = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Áudio acima disso não vai inline (limite da API); cai para o reserva. */
export const GEMINI_MAX_BYTES = 15 * 1024 * 1024;

export function geminiAtivo(): boolean {
  return Boolean(process.env.GOOGLE_AI_API_KEY?.trim());
}

export type ParteGemini = { texto: string } | { dados: Buffer; mime: string };

export interface OpcoesGemini {
  sistema?: string;
  maxTokens?: number;
  temperatura?: number;
  /** resposta em JSON válido */
  json?: boolean;
  /** liga a busca do Google (fundamentação) */
  buscaWeb?: boolean;
  timeoutMs?: number;
}

/** "audio/ogg; codecs=opus" → "audio/ogg" */
export function mimeLimpo(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/** Chama o Gemini. Devolve o texto ou null (sem chave, erro, bloqueio, timeout, vazio). Nunca lança. */
export async function geminiGerar(partes: ParteGemini[], opts: OpcoesGemini = {}): Promise<string | null> {
  const chave = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!chave) return null;
  try {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: opts.maxTokens ?? 1000,
      temperature: opts.temperatura ?? 0.2,
    };
    if (opts.json) generationConfig.responseMimeType = "application/json";
    // O 2.5 Flash "pensa" por padrão e gasta o limite de saída antes de responder: desliga.
    if (/2\.5-flash/.test(GEMINI_MODELO) && !/pro/.test(GEMINI_MODELO)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const res = await fetch(`${BASE}/models/${GEMINI_MODELO}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_PADRAO_MS),
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        ...(opts.sistema ? { system_instruction: { parts: [{ text: opts.sistema }] } } : {}),
        contents: [{
          role: "user",
          parts: partes.map((p) => ("texto" in p ? { text: p.texto } : { inline_data: { mime_type: mimeLimpo(p.mime), data: p.dados.toString("base64") } })),
        }],
        generationConfig,
        ...(opts.buscaWeb ? { tools: [{ google_search: {} }] } : {}),
      }),
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      // 429 = limite do plano gratuito; só o corpo da resposta vai para o log.
      console.error(`[Gemini] HTTP ${res.status}:`, texto.slice(0, 300));
      return null;
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      console.error("[Gemini] bloqueado:", data.promptFeedback.blockReason);
      return null;
    }
    const texto = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    return texto || null;
  } catch (e) {
    console.error("[Gemini]", e instanceof Error ? e.message : "erro de rede");
    return null;
  }
}

const INAUDIVEL = "[inaudível]";

/** Transcreve um áudio do WhatsApp (ogg/opus etc.). null se não houver fala compreensível. */
export async function geminiTranscrever(audio: Buffer, mime: string): Promise<string | null> {
  if (audio.length === 0 || audio.length > GEMINI_MAX_BYTES) return null;
  const texto = await geminiGerar(
    [
      {
        texto:
          "Transcreva fielmente, em português do Brasil, o áudio a seguir. Responda somente com a transcrição, " +
          `sem comentários, sem aspas e sem rótulos. Se não houver fala compreensível, responda exatamente: ${INAUDIVEL}`,
      },
      { dados: audio, mime },
    ],
    { maxTokens: 2000, temperatura: 0 },
  );
  if (!texto || texto.toLowerCase().includes(INAUDIVEL)) return null;
  return texto;
}

/** Lê uma imagem (comprovante, print, foto) e devolve o que foi pedido em `instrucao`. */
export async function geminiLerImagem(imagem: Buffer, mime: string, instrucao: string, opts: OpcoesGemini = {}): Promise<string | null> {
  if (imagem.length === 0 || imagem.length > GEMINI_MAX_BYTES) return null;
  return geminiGerar([{ texto: instrucao }, { dados: imagem, mime }], { maxTokens: 800, temperatura: 0, ...opts });
}
