// DeepSeek como provedor principal de texto — API compatível com a da OpenAI.
//
// Liga sozinho quando existe a variável de ambiente DEEPSEEK_API_KEY (na Vercel:
// Settings → Environment Variables). A chave NUNCA vai no código nem no repositório.
// Sem a variável, nada muda: o sistema segue com OpenAI/Anthropic/Google como antes.
// Com ela, a DeepSeek é a primeira tentativa e os provedores antigos viram reserva,
// então uma falha ou falta de saldo na DeepSeek não derruba o atendimento.
//
// Fica de fora (a DeepSeek não faz): transcrição de áudio (Whisper), voz (TTS) e leitura
// de imagem/comprovante. Esses continuam na OpenAI.

const TIMEOUT_PADRAO_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20000);

export const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
/** Modelo de conversa (rápido, sem raciocínio longo): serve para respostas de WhatsApp em segundos. */
export const DEEPSEEK_MODELO = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

export function deepseekAtivo(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

export interface MensagemChat {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpcoesDeepSeek {
  maxTokens?: number;
  temperature?: number;
  /** Força resposta em JSON válido (o texto do prompt precisa citar "JSON"). */
  json?: boolean;
  timeoutMs?: number;
}

/** Chama a DeepSeek. Devolve o texto ou null (sem chave, erro, timeout, resposta vazia). Nunca lança. */
export async function deepseekChat(mensagens: MensagemChat[], opts: OpcoesDeepSeek = {}): Promise<string | null> {
  const chave = process.env.DEEPSEEK_API_KEY?.trim();
  if (!chave) return null;
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_PADRAO_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODELO,
        messages: mensagens,
        max_tokens: opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.7,
        stream: false,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      // Só o corpo da resposta vai para o log — a chave nunca.
      console.error(`[DeepSeek] HTTP ${res.status}:`, texto.slice(0, 300));
      // 402 = saldo insuficiente na DeepSeek.
      if (res.status === 402 || (await import("./alerta-cota")).ehErroDeCota(texto)) {
        void import("./alerta-cota").then((m) => m.alertarCotaEsgotada("DeepSeek", texto || `HTTP ${res.status}`));
      }
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const texto = data.choices?.[0]?.message?.content?.trim();
    return texto ? texto : null;
  } catch (e) {
    console.error("[DeepSeek]", e instanceof Error ? e.message : "erro de rede");
    return null;
  }
}

/** Nome do provedor de texto que atende primeiro, para o health check (sem expor chave). */
export function provedorPrincipal(): "deepseek" | "openai" | "anthropic" | "google" | "nenhum" {
  if (deepseekAtivo()) return "deepseek";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GOOGLE_AI_API_KEY) return "google";
  return "nenhum";
}
