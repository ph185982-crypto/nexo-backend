import { prisma } from "@/lib/prisma/client";
import { deepseekAtivo, deepseekCompletion } from "@/lib/ai/deepseek";
import { geminiAtivo, geminiGerar } from "@/lib/ai/gemini";

let _cachedKey: string | null = null;
let _cachedKeyAt = 0;

async function getOpenAIKey(): Promise<string> {
  const now = Date.now();
  if (_cachedKey && now - _cachedKeyAt < 300_000) return _cachedKey;
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "OPENAI" },
    select: { refreshToken: true },
  }).catch(() => null);
  const key = cred?.refreshToken ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured — set via /api/integrations/openai");
  _cachedKey = key;
  _cachedKeyAt = now;
  return key;
}

export function invalidateOpenAIKeyCache() { _cachedKey = null; }

/** A chave da OpenAI, se houver — sem lançar erro (a OpenAI é só reserva quando a DeepSeek está ligada). */
async function chaveOpenAIOpcional(): Promise<string | null> {
  try { return await getOpenAIKey(); } catch { return null; }
}

export async function chatCompletion(opts: {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  tool_choice?: string;
  max_tokens?: number;
}): Promise<{
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}> {
  // Com DEEPSEEK_API_KEY a DeepSeek assume o Max (conversa, ferramentas e análises); o modelo
  // pedido (gpt-4o-mini/gpt-4o) é ignorado. A OpenAI só entra de reserva, se houver chave.
  if (deepseekAtivo()) {
    const r = await deepseekCompletion({ messages: opts.messages, tools: opts.tools, tool_choice: opts.tool_choice, max_tokens: opts.max_tokens });
    if (r) return r;
    if (!(await chaveOpenAIOpcional())) throw new Error("DeepSeek indisponível e nenhuma OpenAI de reserva configurada");
  }

  const apiKey = await getOpenAIKey();

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 2048,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    const errText = await res.text();
    if (res.status >= 500 && attempt < 2) {
      console.warn(`[Max/OpenAI] Retry ${attempt + 1}/3 — ${res.status}: ${errText.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }
  throw new Error("OpenAI: exhausted retries");
}

export async function webSearch(query: string): Promise<string> {
  // Gemini com busca do Google primeiro (plano gratuito); OpenAI de reserva.
  if (geminiAtivo()) {
    const r = await geminiGerar([{ texto: query }], {
      sistema: "Pesquise na web e responda em português do Brasil, de forma objetiva, citando as fontes.",
      buscaWeb: true, maxTokens: 900, temperatura: 0.2, timeoutMs: 25_000,
    });
    if (r) return r;
  }
  const apiKey = await chaveOpenAIOpcional();
  if (!apiKey) return "Busca na web indisponível no momento (falta configurar GOOGLE_AI_API_KEY).";

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search" }],
      input: query,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI web search ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const output: Array<{ type: string; content?: unknown }> = data.output ?? [];
  const textItems = output.filter((o) => o.type === "message");
  if (textItems.length > 0) {
    const content = textItems[0].content;
    if (Array.isArray(content)) {
      return content
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text: string }) => c.text)
        .join("\n");
    }
    return String(content);
  }
  return JSON.stringify(data.output ?? "Sem resultados");
}

export async function speechTTS(text: string, voice: string, model: string): Promise<Buffer> {
  const apiKey = await getOpenAIKey();

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text, voice, response_format: "opus" }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS ${res.status}: ${err.slice(0, 300)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
