// CRM_SOMENTE_LEITURA=1 (congelamento do corte): qualquer método diferente de GET responde 423, exceto /api/health.
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { bloqueioSomenteLeitura, somenteLeitura } from "@/lib/auth/somente-leitura";
import { middleware } from "@/middleware";

test("somente leitura: desligado por padrão; só o valor 1 liga", () => {
  assert.equal(somenteLeitura({}), false);
  assert.equal(somenteLeitura({ CRM_SOMENTE_LEITURA: "0" }), false);
  assert.equal(somenteLeitura({ CRM_SOMENTE_LEITURA: "true" }), false);
  assert.equal(somenteLeitura({ CRM_SOMENTE_LEITURA: " 1 " }), true);
  assert.equal(bloqueioSomenteLeitura("POST", "/api/oportunidades", {}), null, "desligado: nada muda");
});

test("somente leitura: 423 para tudo que não é GET (inclusive rotas públicas e de serviço); /api/health passa", async () => {
  const env = { CRM_SOMENTE_LEITURA: "1" };
  for (const m of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]) assert.equal(bloqueioSomenteLeitura(m, "/api/oportunidades", env)?.status, 423, m);
  assert.equal(bloqueioSomenteLeitura("GET", "/api/oportunidades", env), null);
  assert.equal(bloqueioSomenteLeitura("post", "/api/health", env), null);
  const r = bloqueioSomenteLeitura("POST", "/api/integracoes/vendedor-ia/eventos", env)!;
  assert.equal(r.status, 423);
  assert.match((await r.json()).erro, /somente leitura/);

  const antes = process.env.CRM_SOMENTE_LEITURA;
  process.env.CRM_SOMENTE_LEITURA = "1";
  try {
    const rq = (metodo: string, p: string) => middleware(new NextRequest(`http://x${p}`, { method: metodo }));
    for (const [m, p] of [["POST", "/api/login"], ["POST", "/api/integracoes/vendedor-ia/eventos"], ["POST", "/api/integracoes/vendedor-ia/conversas"], ["PATCH", "/api/integracoes/avanteza/entregas/x"],
      ["POST", "/api/publico/propostas/abc"], ["POST", "/api/oportunidades"], ["DELETE", "/api/contatos/x"], ["POST", "/api/cron/automacoes"]]) {
      assert.equal((await rq(m, p)).status, 423, `${m} ${p}`);
    }
    assert.equal((await rq("GET", "/api/health")).headers.get("x-middleware-next"), "1");
    assert.equal((await rq("POST", "/api/health")).headers.get("x-middleware-next"), "1", "health segue como antes");
    assert.equal((await rq("GET", "/login")).headers.get("x-middleware-next"), "1", "leitura continua");
    assert.equal((await rq("GET", "/p/abc")).headers.get("x-middleware-next"), "1");
  } finally { if (antes === undefined) delete process.env.CRM_SOMENTE_LEITURA; else process.env.CRM_SOMENTE_LEITURA = antes; }
  // Desligado de novo: o login volta a passar pelo middleware.
  assert.equal((await middleware(new NextRequest("http://x/api/login", { method: "POST" }))).headers.get("x-middleware-next"), "1");
});
