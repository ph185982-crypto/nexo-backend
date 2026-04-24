// ─── Shared LLM client — used by DecisionService and Responder ───────────────

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  maxTokens?: number;
  temperature?: number;
}

// ─── Provider callers ────────────────────────────────────────────────────────

export async function callOpenAI(
  systemPrompt: string,
  history: LLMMessage[],
  userMessage: string,
  model: string,
  opts: LLMCallOptions = {},
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }],
        max_tokens: opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.85,
      }),
    });
    if (!res.ok) { console.error("[OpenAI]", await res.text()); return null; }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) { console.error("[OpenAI]", e); return null; }
}

export async function callAnthropic(
  systemPrompt: string,
  history: LLMMessage[],
  userMessage: string,
  model: string,
  opts: LLMCallOptions = {},
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userMessage }],
        max_tokens: opts.maxTokens ?? 400,
      }),
    });
    if (!res.ok) { console.error("[Anthropic]", await res.text()); return null; }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text?.trim() ?? null;
  } catch (e) { console.error("[Anthropic]", e); return null; }
}

export async function callGemini(
  systemPrompt: string,
  history: LLMMessage[],
  userMessage: string,
  model: string,
  opts: LLMCallOptions = {},
): Promise<string | null> {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          { role: "user", parts: [{ text: userMessage }] },
        ],
        generationConfig: { maxOutputTokens: opts.maxTokens ?? 400, temperature: opts.temperature ?? 0.85 },
      }),
    });
    if (!res.ok) { console.error("[Gemini]", await res.text()); return null; }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (e) { console.error("[Gemini]", e); return null; }
}

/**
 * Calls the configured provider first; falls back through the chain.
 */
export async function callLLM(
  systemPrompt: string,
  history: LLMMessage[],
  userMessage: string,
  aiProvider?: string | null,
  aiModel?: string | null,
  opts: LLMCallOptions = {},
): Promise<string | null> {
  const p = aiProvider?.toUpperCase();
  if (p === "ANTHROPIC") { const r = await callAnthropic(systemPrompt, history, userMessage, aiModel ?? "claude-haiku-4-5-20251001", opts); if (r) return r; }
  if (p === "OPENAI")    { const r = await callOpenAI(systemPrompt, history, userMessage, aiModel ?? "gpt-4o-mini", opts); if (r) return r; }
  if (p === "GOOGLE")    { const r = await callGemini(systemPrompt, history, userMessage, aiModel ?? "gemini-2.0-flash-lite", opts); if (r) return r; }
  const a = await callAnthropic(systemPrompt, history, userMessage, "claude-haiku-4-5-20251001", opts); if (a) return a;
  const g = await callGemini(systemPrompt, history, userMessage, "gemini-2.0-flash-lite", opts);        if (g) return g;
  const o = await callOpenAI(systemPrompt, history, userMessage, "gpt-4o-mini", opts);                  if (o) return o;
  console.warn("[LLM] No API keys available — all providers failed");
  return null;
}
