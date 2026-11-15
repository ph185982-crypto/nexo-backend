// DeepSeek como provedor principal: só liga com DEEPSEEK_API_KEY, cai para a OpenAI quando
// falha e nunca registra a chave. Usa uma chave FALSA de teste e fetch simulado.
import test from "node:test";
import assert from "node:assert/strict";

const CHAVE_FALSA = "chave-falsa-de-teste-000";

type Chamada = { url: string; auth: string | null; corpo: Record<string, unknown> };

function simular(respostas: Record<string, () => Response>) {
  const chamadas: Chamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const headers = new Headers(init?.headers as HeadersInit);
    chamadas.push({ url: u, auth: headers.get("authorization"), corpo: init?.body ? JSON.parse(String(init.body)) : {} });
    const host = Object.keys(respostas).find((h) => u.includes(h));
    return host ? respostas[host]() : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

const ok = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }] }), { status: 200 });

function ambiente(vars: Record<string, string | undefined>) {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return () => { for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } };
}

test("sem DEEPSEEK_API_KEY nada muda: não chama a DeepSeek e o provedor principal é a OpenAI", async () => {
  const volta = ambiente({ DEEPSEEK_API_KEY: undefined, OPENAI_API_KEY: "fake-openai", ANTHROPIC_API_KEY: undefined, GOOGLE_AI_API_KEY: undefined });
  const sim = simular({ "api.openai.com": () => ok("resposta openai") });
  try {
    const { deepseekAtivo, deepseekChat, provedorPrincipal } = await import("@/lib/ai/deepseek");
    const { callLLM } = await import("@/lib/ai/llm-client");
    assert.equal(deepseekAtivo(), false);
    assert.equal(provedorPrincipal(), "openai");
    assert.equal(await deepseekChat([{ role: "user", content: "oi" }]), null);
    assert.equal(await callLLM("sistema", [], "oi", "OPENAI", "gpt-4o-mini"), "resposta openai");
    assert.ok(sim.chamadas.every((c) => !c.url.includes("deepseek")));
  } finally { sim.restaurar(); volta(); }
});

test("com a chave: a DeepSeek responde primeiro, com o formato certo e a chave só no cabeçalho", async () => {
  const volta = ambiente({ DEEPSEEK_API_KEY: CHAVE_FALSA, DEEPSEEK_BASE_URL: undefined, DEEPSEEK_MODEL: undefined, OPENAI_API_KEY: "fake-openai" });
  const sim = simular({ "api.deepseek.com": () => ok("  resposta deepseek  "), "api.openai.com": () => ok("não deveria chamar") });
  const logs: string[] = [];
  const err = console.error; console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const { deepseekChat, provedorPrincipal } = await import("@/lib/ai/deepseek");
    const { callLLM } = await import("@/lib/ai/llm-client");
    assert.equal(provedorPrincipal(), "deepseek");
    const r = await callLLM("sistema", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], "oi", "OPENAI", "gpt-4o-mini", { maxTokens: 123, temperature: 0.3, responseFormat: "json_object" });
    assert.equal(r, "resposta deepseek");
    assert.equal(sim.chamadas.length, 1, "só a DeepSeek foi chamada");
    const c = sim.chamadas[0];
    assert.equal(c.url, "https://api.deepseek.com/chat/completions");
    assert.equal(c.auth, `Bearer ${CHAVE_FALSA}`);
    assert.equal(c.corpo.model, "deepseek-chat");
    assert.equal(c.corpo.max_tokens, 123);
    assert.equal(c.corpo.temperature, 0.3);
    assert.deepEqual(c.corpo.response_format, { type: "json_object" });
    assert.deepEqual((c.corpo.messages as Array<{ role: string }>).map((m) => m.role), ["system", "user", "assistant", "user"]);
    // sem json: não manda response_format
    await deepseekChat([{ role: "user", content: "oi" }]);
    assert.equal(sim.chamadas[1].corpo.response_format, undefined);
    assert.ok(!logs.some((l) => l.includes(CHAVE_FALSA)), "a chave nunca aparece no log");
  } finally { console.error = err; sim.restaurar(); volta(); }
});

test("DeepSeek falha (500, saldo, rede): cai para a OpenAI e a chave não vai para o log", async () => {
  const volta = ambiente({ DEEPSEEK_API_KEY: CHAVE_FALSA, OPENAI_API_KEY: "fake-openai", ANTHROPIC_API_KEY: undefined, GOOGLE_AI_API_KEY: undefined });
  const logs: string[] = [];
  const err = console.error; console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const { callLLM } = await import("@/lib/ai/llm-client");
    for (const falha of [
      () => new Response("erro interno", { status: 500 }),
      () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 }),
      () => new Response("não autorizado", { status: 401 }),
      () => ok(""),
    ]) {
      const sim = simular({ "api.deepseek.com": falha, "api.openai.com": () => ok("reserva openai") });
      try {
        assert.equal(await callLLM("s", [], "oi", "OPENAI", "gpt-4o-mini"), "reserva openai");
        assert.ok(sim.chamadas[0].url.includes("deepseek") && sim.chamadas[1].url.includes("openai"));
      } finally { sim.restaurar(); }
    }
    assert.ok(!logs.some((l) => l.includes(CHAVE_FALSA)), "a chave nunca aparece no log");
  } finally { console.error = err; volta(); }
});

test("SDR: a DeepSeek responde primeiro em JSON e a OpenAI é a reserva", async () => {
  const volta = ambiente({ DEEPSEEK_API_KEY: CHAVE_FALSA, OPENAI_API_KEY: "fake-openai", ANTHROPIC_API_KEY: undefined, GOOGLE_AI_API_KEY: undefined });
  try {
    const { callSdrLLM } = await import("@/lib/ai/sdr/agent");
    const json = '{"messages":[{"text":"oi"}],"action":"continue"}';
    const a = simular({ "api.deepseek.com": () => ok(json), "api.openai.com": () => ok("não deveria") });
    try {
      assert.equal(await callSdrLLM("prompt JSON", [{ role: "user", content: "x" }], "olá", "OPENAI", "gpt-4o"), json);
      assert.equal(a.chamadas.length, 1);
      assert.deepEqual(a.chamadas[0].corpo.response_format, { type: "json_object" });
      assert.equal(a.chamadas[0].corpo.max_tokens, 1000);
    } finally { a.restaurar(); }
    const b = simular({ "api.deepseek.com": () => new Response("fora do ar", { status: 503 }), "api.openai.com": () => ok(json) });
    try {
      assert.equal(await callSdrLLM("prompt JSON", [], "olá", "OPENAI", "gpt-4o"), json);
      assert.deepEqual(b.chamadas.map((c) => new URL(c.url).host), ["api.deepseek.com", "api.openai.com"]);
    } finally { b.restaurar(); }
    // orçamento de tempo esgotado: nem tenta
    const c = simular({ "api.deepseek.com": () => ok(json) });
    try {
      assert.equal(await callSdrLLM("p", [], "o", "OPENAI", "gpt-4o", Date.now() - 1), null);
      assert.equal(c.chamadas.length, 0);
    } finally { c.restaurar(); }
  } finally { volta(); }
});

test("saldo esgotado na DeepSeek é reconhecido como falta de crédito", async () => {
  const { ehErroDeCota } = await import("@/lib/ai/alerta-cota");
  assert.equal(ehErroDeCota('{"error":{"message":"Insufficient Balance"}}'), true);
  assert.equal(ehErroDeCota("insufficient_quota"), true);
  assert.equal(ehErroDeCota("erro qualquer"), false);
});
