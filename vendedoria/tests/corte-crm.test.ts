// Corte do CRM preparado, não executado (F5): conteúdo de redirecionamentos pronto em crm-redirecionamentos/ e o
// roteiro em docs/CORTE_CRM.md com os passos, reversões e o checklist de 15 itens.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.join(process.cwd(), "..");
const PASTA = path.join(RAIZ, "crm-redirecionamentos");

/** Aplica as rotas do vercel.json como a Vercel faz (primeira que casa vence; $1 vem do grupo). */
function rotear(rotas: Array<{ src: string; status?: number; headers?: Record<string, string>; dest?: string }>, caminho: string) {
  for (const r of rotas) {
    const m = new RegExp(r.src).exec(caminho);
    if (m) return { status: r.status, location: r.headers?.Location?.replace(/\$(\d)/g, (_, i) => m[Number(i)]), dest: r.dest };
  }
  return null;
}

test("crm-redirecionamentos: /p/{token} → 308 para /comercial/p; /api → 410; resto → 308 para /comercial", () => {
  const cfg = JSON.parse(readFileSync(path.join(PASTA, "vercel.json"), "utf8"));
  assert.equal(cfg.framework, null, "site estático, sem build do Next");
  assert.equal(cfg.outputDirectory, "public");
  const r = (p: string) => rotear(cfg.routes, p);
  assert.deepEqual(r("/p/SWZHwG0y1LRfhnO7vZCN7Jc3wT2b3xhn"), { status: 308, location: "https://app.avanteza.com.br/comercial/p/SWZHwG0y1LRfhnO7vZCN7Jc3wT2b3xhn", dest: undefined });
  assert.equal(r("/p/abc/")!.status, 308);
  assert.equal(r("/p/../../x")!.location, "https://app.avanteza.com.br/comercial", "token estranho não vai para a proposta");
  for (const p of ["/api/health", "/api/integracoes/vendedor-ia/eventos", "/api", "/api/integracoes/avanteza/entregas/quadro"]) assert.deepEqual([r(p)!.status, r(p)!.dest], [410, "/410.json"], p);
  for (const p of ["/", "/login", "/oportunidades", "/index.html", "/apix"]) assert.deepEqual([r(p)!.status, r(p)!.location], [308, "https://app.avanteza.com.br/comercial"], p);
  assert.ok(existsSync(path.join(PASTA, "public", "410.json")) && existsSync(path.join(PASTA, "public", "index.html")));
  // A armadilha do deploy vazio: a pasta leva o próprio .vercelignore (cópia do crm/), e o crm/ atual continua com o dele.
  assert.equal(readFileSync(path.join(PASTA, ".vercelignore"), "utf8"), readFileSync(path.join(RAIZ, "crm", ".vercelignore"), "utf8"));
  assert.ok(existsSync(path.join(RAIZ, "vendedoria", ".vercelignore")));
  assert.match(readFileSync(path.join(RAIZ, ".vercelignore"), "utf8"), /^crm-redirecionamentos\/$/m, "o projeto da raiz não publica a pasta");
});

test("docs/CORTE_CRM.md: passos do corte com reversão e checklist de 15 itens", () => {
  const doc = readFileSync(path.join(process.cwd(), "docs", "CORTE_CRM.md"), "utf8");
  for (const trecho of ["CRM_SOMENTE_LEITURA=1", "--refazer --sim --api-supabase", "--verificar", "pg_dump -n crm", "COMERCIAL_NATIVO=1", "CRM_URL=https://nexo-vendedoria.vercel.app", "crm-redirecionamentos/", "Instant Rollback", "Reversão completa"]) {
    assert.ok(doc.includes(trecho), trecho);
  }
  const checklist = doc.split("## Parte B")[1].split("## Parte C")[0];
  assert.equal((checklist.match(/^\d+\. \[ \]/gm) ?? []).length, 15);
});
