/**
 * diagnose.mjs — Diagnóstico completo do fluxo VendedorIA
 *
 * Uso: node scripts/diagnose.mjs
 *
 * Testa cada etapa independentemente sem precisar do WhatsApp real.
 */

const BASE_URL = process.env.APP_URL || "https://vendedoria.onrender.com";
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_API_KEY;
const META_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const META_PHONE_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "945465465327151";
const META_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET || "10119a83dd51952878eefe32b9e98a10";
const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN || "vendedoria_webhook_2025";
import { createHmac } from "crypto";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const BOLD = "\x1b[1m";

function ok(msg) { console.log(`${GREEN}✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}⚠️  ${msg}${RESET}`); }
function info(msg) { console.log(`${BLUE}ℹ️  ${msg}${RESET}`); }
function header(msg) { console.log(`\n${BOLD}${BLUE}═══ ${msg} ═══${RESET}\n`); }

// ─── TESTE 1: Health check (serviço acordado?) ─────────────────────────────
async function test1_health() {
  header("TESTE 1 — Health Check (serviço acordado?)");
  try {
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - t0;
    const body = await res.json();
    if (res.ok && body.status === "ok") {
      ok(`Serviço online em ${ms}ms | DB: ${body.db}`);
      return true;
    } else {
      fail(`Health check retornou ${res.status}: ${JSON.stringify(body)}`);
      return false;
    }
  } catch (e) {
    fail(`Health check falhou: ${e.message}`);
    warn("O serviço pode estar dormindo. Aguarde 60s e tente novamente.");
    return false;
  }
}

// ─── TESTE 2: IA responde diretamente? ────────────────────────────────────
async function test2_ai_direct() {
  header("TESTE 2 — IA responde diretamente (Gemini)?");
  if (!GOOGLE_AI_KEY) {
    fail("GOOGLE_AI_API_KEY não definida — pulando teste");
    return false;
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Olá, responda apenas: OK" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(sem resposta)";
      ok(`Gemini respondeu: "${text.trim()}"`);
      return true;
    } else {
      const err = await res.text();
      fail(`Gemini erro ${res.status}: ${err.slice(0, 200)}`);
      return false;
    }
  } catch (e) {
    fail(`Erro ao chamar Gemini: ${e.message}`);
    return false;
  }
}

// ─── TESTE 3: Token Meta válido? ──────────────────────────────────────────
async function test3_meta_token() {
  header("TESTE 3 — Token Meta WhatsApp válido?");
  if (!META_TOKEN) {
    fail("META_WHATSAPP_ACCESS_TOKEN não definida — pulando teste");
    return false;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${META_PHONE_ID}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
    if (res.ok) {
      const data = await res.json();
      ok(`Token válido | Número: ${data.display_phone_number} | Nome: ${data.verified_name}`);
      return true;
    } else {
      const err = await res.json();
      fail(`Token inválido ${res.status}: ${JSON.stringify(err).slice(0, 300)}`);
      if (err.error?.code === 190) warn("Token EXPIRADO — gere um novo System User Token permanente");
      return false;
    }
  } catch (e) {
    fail(`Erro ao verificar token: ${e.message}`);
    return false;
  }
}

// ─── TESTE 4: Webhook GET (verificação Meta) ──────────────────────────────
async function test4_webhook_verify() {
  header("TESTE 4 — Webhook GET (verificação Meta)");
  try {
    const challenge = "test_challenge_12345";
    const url = `${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`;
    const res = await fetch(url);
    const body = await res.text();
    if (res.ok && body === challenge) {
      ok(`Webhook GET verificado ✓ | VERIFY_TOKEN correto`);
      return true;
    } else if (res.status === 403) {
      fail(`Webhook GET retornou 403 — VERIFY_TOKEN errado no servidor`);
      warn(`Token usado no teste: "${VERIFY_TOKEN}"`);
      return false;
    } else {
      fail(`Webhook GET retornou ${res.status}: "${body.slice(0, 100)}"`);
      return false;
    }
  } catch (e) {
    fail(`Erro no webhook GET: ${e.message}`);
    return false;
  }
}

// ─── TESTE 5: Webhook POST com payload simulado ───────────────────────────
async function test5_webhook_post() {
  header("TESTE 5 — Webhook POST (mensagem simulada com assinatura real)");

  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test-entry",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "+1 555 177 5802",
            phone_number_id: META_PHONE_ID,
          },
          contacts: [{ profile: { name: "Teste Diagnóstico" }, wa_id: "5562984465388" }],
          messages: [{
            id: `wamid.test.${Date.now()}`,
            from: "5562984465388",
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: "text",
            text: { body: "Olá! Isso é um teste de diagnóstico." },
          }],
        },
      }],
    }],
  });

  // Gera assinatura real com o app secret
  const signature = "sha256=" + createHmac("sha256", META_APP_SECRET).update(payload).digest("hex");

  try {
    const res = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: payload,
    });

    const body = await res.text();
    if (res.ok) {
      ok(`Webhook POST aceito ✓ | Resposta: ${body}`);
      info("Verifique os logs do Render para ver o que aconteceu internamente");
      info(`Procure por: '[WhatsApp Webhook] Payload recebido'`);
      info(`Se aparecer '[WhatsApp Webhook] Nenhum providerConfig para phone_number_id: ${META_PHONE_ID}'`);
      info("→ O businessPhoneNumberId no banco não bate com a env var");
      return true;
    } else if (res.status === 401) {
      fail(`Webhook POST retornou 401 — assinatura rejeitada`);
      warn("META_WHATSAPP_APP_SECRET no Render pode estar errado");
      warn("Valor esperado: 10119a83dd51952878eefe32b9e98a10 (32 chars hex)");
      return false;
    } else {
      fail(`Webhook POST retornou ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
  } catch (e) {
    fail(`Erro no webhook POST: ${e.message}`);
    return false;
  }
}

// ─── RESUMO FINAL ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  DIAGNÓSTICO VENDEDORIA — ${new Date().toLocaleString("pt-BR")}  ${RESET}`);
  console.log(`${BOLD}  Alvo: ${BASE_URL}  ${RESET}`);
  console.log(`${BOLD}════════════════════════════════════════${RESET}`);

  const r1 = await test1_health();
  if (!r1) {
    fail("Serviço offline — acorde-o primeiro em: " + BASE_URL + "/api/health");
    process.exit(1);
  }

  const r2 = await test2_ai_direct();
  const r3 = await test3_meta_token();
  const r4 = await test4_webhook_verify();
  const r5 = await test5_webhook_post();

  header("RESUMO DO DIAGNÓSTICO");
  console.log(`Serviço online:        ${r1 ? GREEN+"✅"+RESET : RED+"❌"+RESET}`);
  console.log(`IA (Gemini) ok:        ${r2 ? GREEN+"✅"+RESET : RED+"❌ CHAVE INVÁLIDA/AUSENTE"+RESET}`);
  console.log(`Token Meta ok:         ${r3 ? GREEN+"✅"+RESET : RED+"❌ TOKEN EXPIRADO/INVÁLIDO"+RESET}`);
  console.log(`Webhook verify ok:     ${r4 ? GREEN+"✅"+RESET : RED+"❌ VERIFY_TOKEN ERRADO"+RESET}`);
  console.log(`Webhook POST ok:       ${r5 ? GREEN+"✅"+RESET : RED+"❌ ASSINATURA REJEITADA"+RESET}`);

  if (r1 && r2 && r3 && r4 && r5) {
    console.log(`\n${GREEN}${BOLD}Todos os testes passaram!${RESET}`);
    console.log(`${YELLOW}Próximo passo: verifique os logs do Render após enviar uma mensagem real.${RESET}`);
    console.log(`${YELLOW}Se o providerConfig não for encontrado → o phone_number_id no banco está errado.${RESET}`);
    console.log(`Logs: https://dashboard.render.com/web/srv-d6tk2pogjchc73cgj6gg/logs?r=live`);
  } else {
    console.log(`\n${RED}${BOLD}Encontrado(s) problema(s) — veja os ❌ acima.${RESET}`);
  }
}

main().catch(e => { console.error("Erro fatal:", e); process.exit(1); });
