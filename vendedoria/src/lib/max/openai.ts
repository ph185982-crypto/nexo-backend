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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

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
