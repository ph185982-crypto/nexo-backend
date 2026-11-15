// Gemini (áudio, imagem, busca) e Max na DeepSeek. Chaves FALSAS de teste e fetch simulado.
import test from "node:test";
import assert from "node:assert/strict";

const GEMINI_FALSA = "chave-gemini-falsa-111";
const DEEPSEEK_FALSA = "chave-deepseek-falsa-222";

type Chamada = { url: string; headers: Headers; corpo: Record<string, unknown> | null; bruto: string };

function simular(respostas: Record<string, () => Response>) {
  const chamadas: Chamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const bruto = typeof init?.body === "string" ? init.body : "";
    let corpo: Record<string, unknown> | null = null;
    try { corpo = bruto ? JSON.parse(bruto) : null; } catch { /* multipart */ }
    chamadas.push({ url: u, headers: new Headers(init?.headers as HeadersInit), corpo, bruto });
    const host = Object.keys(respostas).find((h) => u.includes(h));
    return host ? respostas[host]() : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

const gemini = (texto: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
const deepseek = (message: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

function ambiente(vars: Record<string, string | undefined>) {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return () => { for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } };
}

function capturarErros() {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  return { logs, restaurar: () => { console.error = original; } };
}

test("Gemini transcreve áudio: chave só no cabeçalho, áudio inline, 'inaudível' vira null", async () => {
  const volta = ambiente({ GOOGLE_AI_API_KEY: GEMINI_FALSA, GEMINI_MODEL: undefined });
  const log = capturarErros();
  try {
    const { geminiTranscrever } = await import("@/lib/ai/gemini");
    const audio = Buffer.from("audio-de-teste");
    const a = simular({ "generativelanguage.googleapis.com": () => gemini("  oi, quero saber como funciona  ") });
    try {
      assert.equal(await geminiTranscrever(audio, "audio/ogg; codecs=opus"), "oi, quero saber como funciona");
      const c = a.chamadas[0];
      assert.ok(c.url.endsWith("/models/gemini-2.5-flash:generateContent"));
      assert.ok(!c.url.includes(GEMINI_FALSA), "a chave não vai na URL");
      assert.equal(c.headers.get("x-goog-api-key"), GEMINI_FALSA);
      const partes = ((c.corpo!.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]).parts;
      assert.match(String(partes[0].text), /português do Brasil/);
      assert.deepEqual(partes[1], { inline_data: { mime_type: "audio/ogg", data: audio.toString("base64") } });
      assert.deepEqual((c.corpo!.generationConfig as Record<string, unknown>).thinkingConfig, { thinkingBudget: 0 });
    } finally { a.restaurar(); }

    const b = simular({ "generativelanguage.googleapis.com": () => gemini("[inaudível]") });
    try { assert.equal(await geminiTranscrever(audio, "audio/ogg"), null); } finally { b.restaurar(); }

    const c = simular({ "generativelanguage.googleapis.com": () => new Response('{"error":"RESOURCE_EXHAUSTED"}', { status: 429 }) });
    try { assert.equal(await geminiTranscrever(audio, "audio/ogg"), null); } finally { c.restaurar(); }

    const d = simular({ "generativelanguage.googleapis.com": () => gemini("x") });
    try {
      assert.equal(await geminiTranscrever(Buffer.alloc(16 * 1024 * 1024), "audio/ogg"), null, "áudio grande demais nem é enviado");
      assert.equal(d.chamadas.length, 0);
    } finally { d.restaurar(); }
    assert.ok(!log.logs.some((l) => l.includes(GEMINI_FALSA)), "a chave nunca aparece no log");
  } finally { log.restaurar(); volta(); }
});

test("transcribeAudio: Gemini primeiro, Whisper de reserva, sem nada devolve null", async () => {
  const { transcribeAudio } = await import("@/lib/ai/transcription");
  const audio = Buffer.from("x");
  // 1) Gemini responde: o Whisper nem é chamado
  let volta = ambiente({ GOOGLE_AI_API_KEY: GEMINI_FALSA, OPENAI_API_KEY: "fake-openai" });
  let sim = simular({ "generativelanguage.googleapis.com": () => gemini("texto do gemini"), "api.openai.com": () => new Response("texto do whisper") });
  try {
    assert.equal(await transcribeAudio(audio, "audio/ogg"), "texto do gemini");
    assert.ok(sim.chamadas.every((c) => !c.url.includes("openai")));
  } finally { sim.restaurar(); volta(); }
  // 2) Gemini falha: cai para o Whisper
  const log = capturarErros();
  volta = ambiente({ GOOGLE_AI_API_KEY: GEMINI_FALSA, OPENAI_API_KEY: "fake-openai" });
  sim = simular({ "generativelanguage.googleapis.com": () => new Response("erro", { status: 500 }), "api.openai.com": () => new Response("texto do whisper") });
  try {
    assert.equal(await transcribeAudio(audio, "audio/ogg"), "texto do whisper");
    assert.deepEqual(sim.chamadas.map((c) => new URL(c.url).host), ["generativelanguage.googleapis.com", "api.openai.com"]);
  } finally { sim.restaurar(); volta(); }
  // 3) sem Gemini e só Whisper (como antes)
  volta = ambiente({ GOOGLE_AI_API_KEY: undefined, OPENAI_API_KEY: "fake-openai" });
  sim = simular({ "api.openai.com": () => new Response("texto do whisper") });
  try { assert.equal(await transcribeAudio(audio, "audio/ogg"), "texto do whisper"); } finally { sim.restaurar(); volta(); }
  // 4) nenhum provedor
  volta = ambiente({ GOOGLE_AI_API_KEY: undefined, OPENAI_API_KEY: undefined });
  try { assert.equal(await transcribeAudio(audio, "audio/ogg"), null); } finally { volta(); log.restaurar(); }
});

test("Max na DeepSeek: ferramentas passam intactas, o modelo da OpenAI é ignorado e a OpenAI é só reserva", async () => {
  const { chatCompletion, invalidateOpenAIKeyCache } = await import("@/lib/max/openai");
  const tools = [{ type: "function", function: { name: "registrar_transacao", parameters: { type: "object", properties: {} } } }];
  const chamadaDeFerramenta = { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "registrar_transacao", arguments: '{"valor":50}' } }] };
  const log = capturarErros();
  try {
    let volta = ambiente({ DEEPSEEK_API_KEY: DEEPSEEK_FALSA, OPENAI_API_KEY: "fake-openai" });
    invalidateOpenAIKeyCache();
    let sim = simular({ "api.deepseek.com": () => deepseek(chamadaDeFerramenta), "api.openai.com": () => new Response("{}", { status: 500 }) });
    try {
      const r = await chatCompletion({ model: "gpt-4o-mini", messages: [{ role: "user", content: "gastei 50" }], tools, tool_choice: "auto", max_tokens: 700 });
      assert.deepEqual(r.choices[0].message.tool_calls, chamadaDeFerramenta.tool_calls);
      assert.equal(sim.chamadas.length, 1, "só a DeepSeek foi chamada");
      const c = sim.chamadas[0];
      assert.equal(c.url, "https://api.deepseek.com/chat/completions");
      assert.equal(c.headers.get("authorization"), `Bearer ${DEEPSEEK_FALSA}`);
      assert.equal(c.corpo!.model, "deepseek-chat", "gpt-4o-mini é ignorado");
      assert.deepEqual(c.corpo!.tools, tools);
      assert.equal(c.corpo!.tool_choice, "auto");
      assert.equal(c.corpo!.max_tokens, 700);
    } finally { sim.restaurar(); volta(); }

    // DeepSeek cai e há OpenAI: responde a OpenAI
    volta = ambiente({ DEEPSEEK_API_KEY: DEEPSEEK_FALSA, OPENAI_API_KEY: "fake-openai" });
    invalidateOpenAIKeyCache();
    sim = simular({ "api.deepseek.com": () => new Response("fora", { status: 503 }), "api.openai.com": () => deepseek({ role: "assistant", content: "da openai" }) });
    try {
      const r = await chatCompletion({ model: "gpt-4o-mini", messages: [{ role: "user", content: "oi" }] });
      assert.equal(r.choices[0].message.content, "da openai");
      assert.deepEqual(sim.chamadas.map((c) => new URL(c.url).host), ["api.deepseek.com", "api.openai.com"]);
    } finally { sim.restaurar(); volta(); }

    // DeepSeek cai e não há OpenAI: erro claro (o Max avisa "tive um problema")
    volta = ambiente({ DEEPSEEK_API_KEY: DEEPSEEK_FALSA, OPENAI_API_KEY: undefined });
    invalidateOpenAIKeyCache();
    sim = simular({ "api.deepseek.com": () => new Response("fora", { status: 503 }) });
    try {
      await assert.rejects(() => chatCompletion({ model: "gpt-4o-mini", messages: [{ role: "user", content: "oi" }] }), /DeepSeek indisponível/);
    } finally { sim.restaurar(); volta(); invalidateOpenAIKeyCache(); }
    assert.ok(!log.logs.some((l) => l.includes(DEEPSEEK_FALSA)), "a chave nunca aparece no log");
  } finally { log.restaurar(); }
});

test("Max: a imagem do comprovante é lida pelo Gemini e vai como texto para a DeepSeek", async () => {
  const { imagensParaTexto, buildImageContent } = await import("@/lib/max/media");
  const png = Buffer.from("imagem-de-teste");
  const conteudo = buildImageContent(png, "image/png", "paguei agora");
  let volta = ambiente({ GOOGLE_AI_API_KEY: GEMINI_FALSA });
  let sim = simular({ "generativelanguage.googleapis.com": () => gemini("Valor: R$ 120,50\nFavorecido: Energisa\nData: 04/11/2026") });
  try {
    const r = await imagensParaTexto(conteudo);
    assert.equal(typeof r, "string");
    assert.match(String(r), /paguei agora/);
    assert.match(String(r), /registrar_transacao/, "a instrução original continua");
    assert.match(String(r), /\[Leitura automática da imagem recebida\]\nValor: R\$ 120,50/);
    const parte = ((sim.chamadas[0].corpo!.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]).parts[1];
    assert.deepEqual(parte, { inline_data: { mime_type: "image/png", data: png.toString("base64") } });
  } finally { sim.restaurar(); volta(); }
  // sem Gemini: avisa que não conseguiu ler (nunca inventa valor)
  volta = ambiente({ GOOGLE_AI_API_KEY: undefined });
  try { assert.match(String(await imagensParaTexto(conteudo)), /não consegui lê-la/); } finally { volta(); }
  // texto puro passa direto
  assert.equal(await imagensParaTexto("gastei 50"), "gastei 50");
});

test("Max: busca na web usa o Gemini com busca do Google", async () => {
  const { webSearch, invalidateOpenAIKeyCache } = await import("@/lib/max/openai");
  let volta = ambiente({ GOOGLE_AI_API_KEY: GEMINI_FALSA, OPENAI_API_KEY: undefined });
  invalidateOpenAIKeyCache();
  let sim = simular({ "generativelanguage.googleapis.com": () => gemini("A Selic está em X% (fonte: Banco Central)") });
  try {
    assert.match(await webSearch("selic hoje"), /Selic/);
    assert.deepEqual(sim.chamadas[0].corpo!.tools, [{ google_search: {} }]);
  } finally { sim.restaurar(); volta(); invalidateOpenAIKeyCache(); }
  // sem nenhum provedor: mensagem amigável, não erro
  volta = ambiente({ GOOGLE_AI_API_KEY: undefined, OPENAI_API_KEY: undefined });
  invalidateOpenAIKeyCache();
  try { assert.match(await webSearch("x"), /indisponível/); } finally { volta(); invalidateOpenAIKeyCache(); }
});
