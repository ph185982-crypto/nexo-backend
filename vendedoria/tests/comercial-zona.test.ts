// Endereço único (F5/C1–C6): app.avanteza.com.br/comercial/* = Vendedor IA por reescrita na Central, sem basePath.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { ALIASES_LEGADOS, ativo, caminhoReal, hrefNaZona, naZona, ZONA } from "@/lib/zona-comercial";
import { authConfig, urlLoginUnico } from "@/lib/auth/config";
import { paginaPublica } from "@/lib/auth/rotas-publicas";

const ler = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

test("links: na zona, telas antigas ganham endereço sob /comercial; fora dela, nada muda", () => {
  const z = "/comercial/oportunidades";
  assert.equal(hrefNaZona("/crm/conversations", z), "/comercial/conversas");
  assert.equal(hrefNaZona("/crm/conversations?id=9", z), "/comercial/conversas?id=9");
  assert.equal(hrefNaZona("/crm/lead/kanban", z), "/comercial/leads");
  assert.equal(hrefNaZona("/crm/configure-agent", z), "/comercial/agente");
  assert.equal(hrefNaZona("/crm/settings", z), "/comercial/configuracoes");
  assert.equal(hrefNaZona("/crm/lead/123", z), "/comercial/crm/lead/123", "genérico");
  assert.equal(hrefNaZona("/crm", z), "/comercial");
  assert.equal(hrefNaZona("/crmx", z), "/crmx", "prefixo exato");
  assert.equal(hrefNaZona("/comercial/contatos", z), "/comercial/contatos");
  assert.equal(hrefNaZona("https://app.avanteza.com.br/financeiro", z), "https://app.avanteza.com.br/financeiro");
  assert.equal(hrefNaZona("//evil.com", z), "//evil.com");
  for (const fora of ["/crm/dashboard", "/", "/login"]) assert.equal(hrefNaZona("/crm/conversations", fora), "/crm/conversations", fora);
  // ida e volta: o endereço da zona abre a tela real
  for (const { zona, legado } of ALIASES_LEGADOS) {
    assert.equal(caminhoReal(hrefNaZona(legado, z)), legado);
    assert.equal(caminhoReal(`${zona}/x`), `${legado}/x`);
  }
  assert.equal(caminhoReal("/comercial/crm/lead/1"), "/crm/lead/1");
  assert.equal(caminhoReal("/comercial/oportunidades"), "/comercial/oportunidades", "telas novas são reais");
  assert.ok(naZona("/comercial") && naZona("/comercial/x") && !naZona("/comerciais"));
  assert.equal(ativo("/icon-192.png"), "/comercial/icon-192.png");
});

test("next.config: assetPrefix e imagens sob /comercial, sem basePath; reescritas da zona; webhooks intactos", async () => {
  const cfg = (await import("../next.config")).default as { assetPrefix?: string; basePath?: string; images?: { path?: string }; rewrites: () => Promise<{ beforeFiles: Array<{ source: string; destination: string }>; afterFiles: Array<{ source: string; destination: string }> }> };
  assert.equal(cfg.assetPrefix, ZONA);
  assert.equal(cfg.basePath, undefined, "basePath moveria /api/webhooks/whatsapp");
  assert.equal(cfg.images?.path, "/comercial/_next/image");
  const r = await cfg.rewrites();
  const antes = Object.fromEntries(r.beforeFiles.map((x) => [x.source, x.destination]));
  assert.equal(antes["/comercial/_next/:path*"], "/_next/:path*");
  assert.equal(antes["/comercial/fonts/:path*"], "/fonts/:path*");
  assert.equal(antes["/comercial/icon-192.png"], "/icon-192.png");
  const depois = Object.fromEntries(r.afterFiles.map((x) => [x.source, x.destination]));
  assert.equal(depois["/comercial/api/:path*"], "/api/:path*");
  assert.equal(depois["/comercial/conversas/:path*"], "/crm/conversations/:path*");
  assert.equal(depois["/comercial/crm/:path*"], "/crm/:path*");
  const todas = [...r.beforeFiles, ...r.afterFiles];
  assert.ok(!todas.some((x) => /webhooks/.test(x.source) || /webhooks/.test(x.destination)), "webhooks não são reescritos");
  assert.ok(!todas.some((x) => x.source.startsWith("/api/")), "nada de /api/* reescrito");
});

test("acesso: estáticos da zona públicos; página da zona sem sessão vai ao login único da Central; /crm segue com /login", async () => {
  for (const p of ["/comercial/_next/static/chunks/a.js", "/comercial/_next/image", "/comercial/fonts/Manrope-Bold.ttf", "/comercial/icon-192.png", "/comercial/manifest.json", "/comercial/p/abc"]) assert.ok(paginaPublica(p), p);
  for (const p of ["/comercial/oportunidades", "/comercial/conversas", "/comercial/icon-192.png.js", "/comercial/fontsx", "/comercial/_nextx/a"]) assert.ok(!paginaPublica(p), p);

  const authorized = authConfig.callbacks!.authorized!;
  const decidir = (url: string, logado = false) => authorized({ auth: logado ? ({ user: { id: "u" } } as never) : null, request: new NextRequest(url) } as never);
  const antes = process.env.AVANTEZA_HUB_URL;
  process.env.AVANTEZA_HUB_URL = "https://central.exemplo/";
  try {
    const r = (await decidir("https://app.avanteza.com.br/comercial/conversas?id=1")) as Response;
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get("location")!);
    assert.equal(`${loc.origin}${loc.pathname}`, "https://central.exemplo/sso/authorize");
    assert.deepEqual([loc.searchParams.get("app"), loc.searchParams.get("return")], ["vendas", "/comercial/conversas?id=1"]);
    assert.equal(await decidir("https://app.avanteza.com.br/comercial/conversas", true), true);
    assert.equal(await decidir("https://app.avanteza.com.br/comercial/_next/static/x.js"), true);
    assert.equal(await decidir("https://nexo-vendedoria.vercel.app/crm/conversations"), false, "/crm: tela /login, como antes");
    const api = (await decidir("https://app.avanteza.com.br/comercial/api/comercial/oportunidades")) as Response;
    assert.equal(api.status, 401, "API da zona sem sessão: 401");
    assert.equal(await decidir("https://app.avanteza.com.br/comercial/api/webhooks/whatsapp"), true, "mesma regra de /api/*");
  } finally { if (antes === undefined) delete process.env.AVANTEZA_HUB_URL; else process.env.AVANTEZA_HUB_URL = antes; }
  assert.equal(new URL(urlLoginUnico("//evil.com", "https://h")).searchParams.get("return"), "/comercial", "caminho externo vira a entrada da zona");
});

test("NextAuth sob /comercial/api/auth: o prefixo sai antes de o NextAuth ler a ação", async () => {
  process.env.AUTH_SECRET ??= "segredo-de-teste-do-nextauth-123456";
  const { GET } = await import("@/app/api/auth/[...nextauth]/route");
  const zona = await GET(new NextRequest("http://127.0.0.1/comercial/api/auth/csrf"));
  assert.equal(zona.status, 200);
  assert.ok(typeof (await zona.json()).csrfToken === "string");
  const antigo = await GET(new NextRequest("http://127.0.0.1/api/auth/csrf"));
  assert.equal(antigo.status, 200, "domínio antigo igual");
});

test("navegador: service worker não registra sob /comercial; sessão e links da moldura seguem a zona", () => {
  const layout = ler("src/app/layout.tsx");
  assert.match(layout, /!\/\^\\\\\/comercial/, "o SW do Vendedor IA (escopo /) tomaria a Central");
  assert.match(layout, /ativo\("\/manifest\.json"\)/);
  assert.match(ler("src/app/crm/layout.tsx"), /SessionProvider basePath=\{apiUrl\("\/api\/auth"\)\}/);
  assert.match(ler("src/components/layout/Sidebar.tsx"), /hrefNaZona\(h, pathname\)/);
  assert.match(ler("src/components/layout/MobileTabBar.tsx"), /hrefNaZona\(t\.href, pathname\)/);
  assert.match(ler("src/lib/comercial/contratos/pdf.ts"), /fetch\(ativo\("\/fonts\/"/);
  // href renderizado com "/api/…" cru quebra sob a Central: só por apiUrl/useApiUrl ou com o clique trocando o endereço
  const crus = ["src/components/layout/Header.tsx", "src/components/prospeccao/Disparo.tsx", "src/app/crm/settings/page.tsx", "src/app/crm/calendar/page.tsx"]
    .flatMap((f) => [...ler(f).matchAll(/href="\/api\/[^"]+"(?![^>]*onClick=\{\(e\) => \{ e\.preventDefault\(\); window\.location\.href = apiUrl)/g)].map((m) => `${f}: ${m[0]}`));
  assert.deepEqual(crus, []);
});

test("link público da proposta: /comercial/p/{token}, no endereço público quando configurado", async () => {
  const { linkPublicoProposta } = await import("@/lib/zona-comercial");
  assert.equal(linkPublicoProposta("abc", "https://nexo-vendedoria.vercel.app", {}), "https://nexo-vendedoria.vercel.app/comercial/p/abc");
  assert.equal(linkPublicoProposta("abc", "https://nexo-vendedoria.vercel.app", { COMERCIAL_URL_PUBLICA: "https://app.avanteza.com.br/comercial/" }), "https://app.avanteza.com.br/comercial/p/abc");
  assert.ok(!/`\$\{window\.location\.origin\}\/p\//.test(ler("src/components/comercial/ficha-propostas.tsx")), "sem o /p/ do CRM antigo");
});
