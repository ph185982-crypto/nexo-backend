// Toda rota de app/api/comercial responde 401 sem sessão (exceto a proposta pública, que tem o token como credencial).
// Varre as pastas: rota nova entra no teste sozinha. Também confere a regra do middleware para /api/comercial e o
// alias /comercial/api (o prefixo é normalizado antes de decidir: o alias não fura a proteção).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { definirLeitorDeSessao } from "@/lib/comercial/auth/requisicao";

const RAIZ = path.join(process.cwd(), "src", "app", "api", "comercial");
const PUBLICAS = [path.join("publico", "propostas") + path.sep];
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const rotas = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? rotas(p) : e.name === "route.ts" ? [p] : [];
});

test("toda rota de /api/comercial exige sessão (401 sem login)", async () => {
  definirLeitorDeSessao(async () => null);
  try {
    const arquivos = rotas(RAIZ);
    assert.ok(arquivos.length >= 30, `rotas encontradas: ${arquivos.length}`);
    const abertas: string[] = [];
    let conferidas = 0;
    for (const arq of arquivos) {
      const rel = path.relative(RAIZ, arq);
      if (PUBLICAS.some((p) => rel.startsWith(p))) continue;
      const mod = (await import(arq)) as Record<string, unknown>;
      for (const m of METODOS) {
        const h = mod[m];
        if (typeof h !== "function") continue;
        const url = `http://x/api/comercial/${rel.replace(/\/?route\.ts$/, "")}?de=2026-01-01&ate=2026-01-02`;
        const req = new Request(url, { method: m, headers: { "content-type": "application/json" }, ...(m === "GET" ? {} : { body: "{}" }) });
        const ctx = { params: Promise.resolve({ id: "x", token: "x", cartaoId: "x", linhaId: "x" }) };
        const r = (await (h as (req: Request, ctx: unknown) => Promise<Response>)(req, ctx)) as Response;
        conferidas++;
        if (r.status !== 401) abertas.push(`${m} ${rel} → ${r.status}`);
      }
    }
    assert.deepEqual(abertas, []);
    assert.ok(conferidas >= 40, `handlers conferidos: ${conferidas}`);
  } finally {
    definirLeitorDeSessao(null);
  }
});

test("middleware: /api/comercial e /comercial/api fechados; só a proposta pública passa sem login", async () => {
  const { decidirAcessoApi, rotaPublica, paginaPublica, PREFIXOS_PUBLICOS } = await import("@/lib/auth/rotas-publicas");
  const H = { get: () => null };
  for (const p of ["/api/comercial/oportunidades", "/api/comercial/contatos/exportar", "/comercial/api/comercial/tarefas", "/comercial/api/graphql", "/api/comercial/publico", "/api/comercial/publicoX/propostas/a"]) {
    assert.equal(decidirAcessoApi(p.startsWith("/comercial/api/") ? p.slice(9) : p, false, H), "negar", p);
  }
  assert.equal(rotaPublica("/api/comercial/publico/propostas/abc"), true);
  assert.equal(rotaPublica("/comercial/api/comercial/publico/propostas/abc"), true, "alias normalizado");
  assert.equal(rotaPublica("/comercial/api/webhooks/whatsapp"), true, "o alias segue as mesmas regras de /api");
  assert.equal(paginaPublica("/comercial/p/abc"), true);
  assert.equal(paginaPublica("/comercial/oportunidades"), false);
  assert.equal(paginaPublica("/comercial/pagina"), false);
  // Só um prefixo novo do Comercial na lista pública.
  assert.deepEqual(PREFIXOS_PUBLICOS.filter((p) => p.includes("comercial")), ["/api/comercial/publico/propostas/"]);
  const mw = fs.readFileSync(path.join(process.cwd(), "src", "middleware.ts"), "utf8");
  assert.match(mw, /"\/comercial\/:path\*"/, "o middleware cobre /comercial/*");
  assert.match(fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8"), /source: "\/comercial\/api\/:path\*", destination: "\/api\/:path\*"/, "alias da API sob /comercial");
});
