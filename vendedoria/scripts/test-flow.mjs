/**
 * test-flow.mjs — Teste passo a passo do fluxo WhatsApp → IA
 *
 * Uso:
 *   GOOGLE_AI_API_KEY=xxx node scripts/test-flow.mjs
 *   ou
 *   APP_URL=https://vendedoria.onrender.com META_APP_SECRET=xxx node scripts/test-flow.mjs
 */

import { createHmac } from "crypto";

const APP_URL = process.env.APP_URL || "https://vendedoria.onrender.com";
const GOOGLE_KEY = process.env.GOOGLE_AI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const META_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const APP_SECRET = process.env.META_WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN || "vendedoria_webhook_2025";
const PHONE_NUMBER_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "CONFIGURE_ME";
const CRON_SECRET = process.env.CRON_SECRET;

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[34m", W = "\x1b[1m", X = "\x1b[0m";
const ok   = (m) => console.log(`${G}✅ ${m}${X}`);
const fail = (m) => console.log(`${R}❌ ${m}${X}`);
const warn = (m) => console.log(`${Y}⚠️  ${m}${X}`);
const info = (m) => console.log(`${B}ℹ️  ${m}${X}`);
const sep  = (m) => console.log(`\n${W}${B}━━━ ${m} ━━━${X}\n`);

// ─── TESTE 1: Serviço está online? ──────────────────────────────────────────
async function teste1_health() {
  sep("TESTE 1 — Serviço online?");
  try {
    const t = Date.now();
    const r = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(20000) });
    const body = await r.json();
    if (r.ok) {
      ok(`Online em ${Date.now()-t}ms | DB: ${body.db}`);
      return true;
    } else {
      fail(`Status ${r.status}: ${JSON.stringify(body)}`);
      return false;
    }
  } catch (e) {
    fail(`Falhou: ${e.message}`);
    warn("Possível cold start — aguarde 60s e re-execute.");
    return false;
  }
}

// ─── TESTE 2: IA responde diretamente? ──────────────────────────────────────
async function teste2_ia_direta() {
  sep("TESTE 2 — IA responde diretamente?");

  if (GOOGLE_KEY) {
    info("Testando Google Gemini...");
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Responda só: OK" }] }],
          }),
        }
      );
      const data = await r.json();
      if (r.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        ok(`Gemini respondeu: "${text?.slice(0,80)}"`);
      } else {
        fail(`Gemini erro ${r.status}: ${JSON.stringify(data).slice(0,200)}`);
      }
    } catch (e) { fail(`Gemini exception: ${e.message}`); }
  } else warn("GOOGLE_AI_API_KEY não definida — pulando Gemini");

  if (ANTHROPIC_KEY) {
    info("Testando Anthropic Claude...");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 20,
          messages: [{ role: "user", content: "Responda só: OK" }],
        }),
      });
      const data = await r.json();
      if (r.ok) {
        ok(`Anthropic respondeu: "${data.content?.[0]?.text?.slice(0,80)}"`);
      } else {
        fail(`Anthropic erro ${r.status}: ${JSON.stringify(data).slice(0,200)}`);
      }
    } catch (e) { fail(`Anthropic exception: ${e.message}`); }
  } else warn("ANTHROPIC_API_KEY não definida — pulando");

  if (OPENAI_KEY) {
    info("Testando OpenAI...");
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 20,
          messages: [{ role: "user", content: "Responda só: OK" }],
        }),
      });
      const data = await r.json();
      if (r.ok) {
        ok(`OpenAI respondeu: "${data.choices?.[0]?.message?.content?.slice(0,80)}"`);
      } else {
        fail(`OpenAI erro ${r.status}: ${JSON.stringify(data).slice(0,200)}`);
      }
    } catch (e) { fail(`OpenAI exception: ${e.message}`); }
  } else warn("OPENAI_API_KEY não definida — pulando");

  if (!GOOGLE_KEY && !ANTHROPIC_KEY && !OPENAI_KEY) {
    fail("Nenhuma chave de IA definida! Configure ao menos uma.");
    return false;
  }
  return true;
}

// ─── TESTE 3: Token Meta é válido? ──────────────────────────────────────────
async function teste3_meta_token() {
  sep("TESTE 3 — Token Meta válido?");
  if (!META_TOKEN) { warn("META_WHATSAPP_ACCESS_TOKEN não definido — pulando"); return false; }
  try {
    const r = await fetch(
      `https://graph.facebook.com/v20.0/me?access_token=${META_TOKEN}`
    );
    const data = await r.json();
    if (r.ok) {
      ok(`Token válido. ID: ${data.id} | Nome: ${data.name}`);
      if (data.name?.includes("User")) {
        warn("Parece um User Token (expira em 60 dias). Use System User Token para produção.");
      }
      return true;
    } else {
      fail(`Token inválido: ${data.error?.message}`);
      if (data.error?.code === 190) fail("Token EXPIRADO — gere um novo System User Token.");
      return false;
    }
  } catch (e) { fail(`Exceção: ${e.message}`); return false; }
}

// ─── TESTE 4: Webhook GET (verificação Meta) ─────────────────────────────────
async function teste4_webhook_get() {
  sep("TESTE 4 — Webhook GET (verificação Meta)");
  const challenge = "test_challenge_" + Date.now();
  const url = `${APP_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    if (r.ok && text === challenge) {
      ok(`Webhook GET funcionando. Challenge retornado corretamente.`);
      return true;
    } else {
      fail(`Webhook GET falhou. Status: ${r.status} | Body: "${text}"`);
      if (r.status === 403) warn("VERIFY_TOKEN não bate — verifique META_WHATSAPP_VERIFY_TOKEN");
      return false;
    }
  } catch (e) { fail(`Exceção: ${e.message}`); return false; }
}

// ─── TESTE 5: Webhook POST (mensagem simulada) ────────────────────────────────
async function teste5_webhook_post() {
  sep("TESTE 5 — Webhook POST (mensagem simulada)");
  if (!APP_SECRET) {
    warn("META_WHATSAPP_APP_SECRET não definido — não é possível gerar assinatura HMAC");
    warn("Execute com: META_WHATSAPP_APP_SECRET=seu_secret node scripts/test-flow.mjs");
    return false;
  }

  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test-entry",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5562984465388", phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Teste Diagnóstico" }, wa_id: "5511999999999" }],
          messages: [{
            id: "wamid.test_" + Date.now(),
            from: "5511999999999",
            type: "text",
            text: { body: "Olá, tudo bem? (mensagem de teste de diagnóstico)" },
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }],
        },
      }],
    }],
  });

  const sig = "sha256=" + createHmac("sha256", APP_SECRET).update(payload).digest("hex");

  try {
    const r = await fetch(`${APP_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": sig,
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json();
    if (r.ok && body.success) {
      ok(`Webhook POST aceito. Resposta: ${JSON.stringify(body)}`);
      info("A IA foi disparada de forma assíncrona. Verifique os logs do Render para confirmar.");
      return true;
    } else {
      fail(`Webhook POST falhou. Status: ${r.status} | Body: ${JSON.stringify(body)}`);
      if (r.status === 401) fail("Assinatura HMAC inválida — APP_SECRET errado");
      if (r.status === 500) fail("Erro interno — verifique logs do Render");
      return false;
    }
  } catch (e) { fail(`Exceção: ${e.message}`); return false; }
}

// ─── TESTE 6: Estado do banco (debug/status) ─────────────────────────────────
async function teste6_db_status() {
  sep("TESTE 6 — Estado do banco (providerConfig + agente)");
  if (!CRON_SECRET) {
    warn("CRON_SECRET não definido — pulando (endpoint protegido)");
    info("Execute com: CRON_SECRET=valor_do_render node scripts/test-flow.mjs");
    return false;
  }
  try {
    const r = await fetch(`${APP_URL}/api/debug/status?secret=${CRON_SECRET}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404) {
      warn("Endpoint /api/debug/status não existe ainda — será disponível após o próximo deploy.");
      return false;
    }
    const data = await r.json();
    if (!r.ok) { fail(`Status ${r.status}: ${JSON.stringify(data)}`); return false; }

    info("Variáveis de ambiente no servidor:");
    for (const [k, v] of Object.entries(data.env ?? {})) {
      console.log(`  ${v ? G+"✅" : R+"❌"} ${k}${X}`);
    }

    if (data.providerConfigs?.length === 0) {
      fail("Nenhum providerConfig no banco! Execute o seed: npx prisma db seed");
      return false;
    }

    for (const cfg of data.providerConfigs ?? []) {
      info(`\nProviderConfig: ${cfg.id}`);
      console.log(`  phone_number_id: ${cfg.businessPhoneNumberId}`);
      console.log(`  accessToken: ${cfg.accessTokenPrefix}...`);
      if (cfg.agent) {
        const agentOk = cfg.agent.kind === "AI" && cfg.agent.status === "ACTIVE";
        console.log(`  agente: ${agentOk ? G+"✅" : R+"❌"} kind=${cfg.agent.kind} status=${cfg.agent.status} provider=${cfg.agent.aiProvider} model=${cfg.agent.aiModel}${X}`);
        if (cfg.agent.kind !== "AI") fail("Agente kind não é AI!");
        if (cfg.agent.status !== "ACTIVE") fail("Agente status não é ACTIVE!");
      } else {
        fail("Nenhum agente IA vinculado ao providerConfig!");
      }
    }
    return true;
  } catch (e) { fail(`Exceção: ${e.message}`); return false; }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
console.log(`\n${W}${B}╔══════════════════════════════════════════╗`);
console.log(`║   VendedorIA — Diagnóstico Completo     ║`);
console.log(`╚══════════════════════════════════════════╝${X}`);
console.log(`APP_URL: ${APP_URL}\n`);

const r1 = await teste1_health();
const r2 = await teste2_ia_direta();
const r3 = await teste3_meta_token();
const r4 = await teste4_webhook_get();
const r5 = await teste5_webhook_post();
const r6 = await teste6_db_status();

sep("RESUMO FINAL");
console.log(`Serviço online:      ${r1 ? G+"✅"+X : R+"❌"+X}`);
console.log(`IA responde:         ${r2 ? G+"✅"+X : R+"❌"+X}`);
console.log(`Token Meta válido:   ${r3 ? G+"✅"+X : R+"❌"+X}`);
console.log(`Webhook GET:         ${r4 ? G+"✅"+X : R+"❌"+X}`);
console.log(`Webhook POST:        ${r5 ? G+"✅"+X : R+"❌"+X}`);
console.log(`DB / Agent config:   ${r6 ? G+"✅"+X : R+"❌"+X}`);

if (r1 && r2 && r4 && r5 && r6) {
  console.log(`\n${G}${W}🎉 Todos os testes passaram! Se a IA ainda não responde,`);
  console.log(`   o problema está no phone_number_id do Meta não bater com o banco.${X}`);
} else {
  console.log(`\n${R}${W}⚠️  Há falhas acima. Corrija cada uma na ordem e re-execute.${X}`);
}
