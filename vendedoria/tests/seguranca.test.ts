// Item 2 do diagnóstico (30/10): rotas /api/* fechadas por padrão, assinatura
// do webhook do Mercado Pago e limite de tentativas de login.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const temBanco = Boolean(process.env.DATABASE_URL);
const H = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

test("API fechada por padrão: anônimo é negado, logado/credencial/pública passam", async () => {
  const { decidirAcessoApi } = await import("@/lib/auth/rotas-publicas");
  // Os buracos do diagnóstico
  for (const p of ["/api/followups", "/api/agent/prompt/restore", "/api/ai/followup", "/api/integrations/google/status", "/api/leads/x/tags", "/api/products", "/api/pedidos/nacionais", "/api/admin/api-keys"]) {
    assert.equal(decidirAcessoApi(p, false, H()), "negar", p);
    assert.equal(decidirAcessoApi(p, true, H()), "permitir", `${p} logado`);
  }
  // Credenciais que a rota valida
  assert.equal(decidirAcessoApi("/api/prospeccao/fila", false, H({ "x-api-key": "nexo_live_x" })), "permitir");
  assert.equal(decidirAcessoApi("/api/graphql", false, H({ authorization: "Bearer nexo_live_x" })), "permitir");
  assert.equal(decidirAcessoApi("/api/prospeccao/disparo/executar/o", false, H({ "x-cron-secret": "s" })), "permitir");
  assert.equal(decidirAcessoApi("/api/followups", false, H({ authorization: "   " })), "negar", "header vazio não conta");
  // Públicas por desenho
  for (const p of ["/api/health", "/api/auth/session", "/api/webhooks/whatsapp", "/api/pagamentos/webhook", "/api/cron/followup", "/api/oauth/token", "/api/mcp", "/api/checkout/abc/pix", "/api/cep/74965560", "/api/push/vapid-public-key", "/api/debug/status", "/api/admin/setup", "/api/integrations/google/callback"]) {
    assert.equal(decidirAcessoApi(p, false, H()), "permitir", p);
  }
  assert.equal(decidirAcessoApi("/api/healthcheck-falso", false, H()), "negar", "prefixo não vaza para vizinhos");
});

test("assinatura do Mercado Pago: válida passa, adulterada não", async () => {
  const { validarAssinaturaMercadoPago } = await import("@/lib/pagamento/assinatura-webhook");
  const secret = "segredo-teste";
  const ts = "1700000000";
  const v1 = createHmac("sha256", secret).update(`id:123abc;request-id:req-1;ts:${ts};`).digest("hex");
  const base = { xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123ABC", secret };
  assert.equal(validarAssinaturaMercadoPago(base), true);
  assert.equal(validarAssinaturaMercadoPago({ ...base, dataId: "999" }), false);
  assert.equal(validarAssinaturaMercadoPago({ ...base, secret: "outro" }), false);
  assert.equal(validarAssinaturaMercadoPago({ ...base, xSignature: null }), false);
});

test("login: 10 falhas em 15 min bloqueiam; sucesso limpa", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { loginBloqueado, registrarFalhaLogin, limparFalhasLogin, MAX_POR_EMAIL } = await import("@/lib/auth/tentativas");
  const email = `t${Date.now()}@x.com`;
  try {
    assert.equal(await loginBloqueado(email, "1.2.3.4"), false);
    for (let i = 0; i < MAX_POR_EMAIL; i++) await registrarFalhaLogin(email, "1.2.3.4");
    assert.equal(await loginBloqueado(email, "1.2.3.4"), true);
    await limparFalhasLogin(email);
    assert.equal(await loginBloqueado(email, "1.2.3.4"), false);
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { chave: { in: [`email:${email}`, "ip:1.2.3.4"] } } });
    await prisma.$disconnect();
  }
});
