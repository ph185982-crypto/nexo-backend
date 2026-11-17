// Visual "vidro" da plataforma Avanteza no Vendedor IA/Comercial (regra do dono, nov/2026): tokens do kit presentes e
// mapeados no tema do Tailwind, contraste AA calculado no PIOR caso do fundo (pico da orbe + vidro empilhado) nos dois
// temas, Plus Jakarta Sans, sem hex soltos nas telas, laranja nunca como texto sobre fundo claro, tema sem flash e o
// menu lateral no desenho da Central.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RGB = [number, number, number];
const ler = (f: string) => fs.readFileSync(f, "utf8");
const hex = (h: string): RGB => {
  const s = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
};
const paraHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const sobre = (fundo: RGB, cor: RGB, a: number): RGB => fundo.map((c, i) => c * (1 - a) + cor[i] * a) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contraste = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const perto = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
function hsl(v: string): RGB {
  const [h, s, l] = v.replace(/%/g, "").trim().split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const rgbTriplet = (v: string): RGB => v.trim().split(/\s+/).map(Number) as RGB;
const rgbaCor = (v: string): RGB => (v.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)!.slice(1, 4).map(Number) as RGB);

// ── Tokens do kit (cópia em src/styles) ──────────────────────────────────────────────────────────────────────────
const KIT = "src/styles/avanteza-tokens.css";
const kit = ler(KIT);
const bloco = (css: string, seletor: string) => {
  const i = css.indexOf(seletor + " {");
  assert.ok(i >= 0, `bloco ${seletor} ausente`);
  return css.slice(i, css.indexOf("\n}", i));
};
const kitEscuro = bloco(kit, ':root, :root[data-theme="dark"]');
const kitClaro = bloco(kit, ':root[data-theme="light"]');
/** Token do kit: o bloco do tema vale mais; o que o claro não redefine vem do escuro (base). */
const avz = (tema: "dark" | "light") => (n: string) => {
  for (const b of tema === "light" ? [kitClaro, kitEscuro] : [kitEscuro]) {
    const m = b.match(new RegExp(`--avz-${n}:\\s*([^;]+);`));
    if (m) return m[1].trim();
  }
  assert.fail(`token --avz-${n} ausente (${tema})`);
};

// ── Tema do Tailwind/shadcn (globals.css) ────────────────────────────────────────────────────────────────────────
const css = ler("src/app/globals.css");
const temaEscuro = bloco(css, ':root, :root[data-theme="dark"], .dark');
const temaClaro = bloco(css, ':root[data-theme="light"]');
const tw = (tema: "dark" | "light") => (n: string) => {
  const m = (tema === "dark" ? temaEscuro : temaClaro).match(new RegExp(`--${n}:\\s*([^;]+);`));
  assert.ok(m, `--${n} ausente no tema ${tema}`);
  return m![1].trim();
};

test("kit: cópia presente, com o aviso de não editar, todos os tokens nos dois temas e importada no layout", () => {
  assert.match(kit.slice(0, 200), /cópia do kit.*não editar aqui/i);
  const nomes = ["navy", "cream", "sand", "orange", "orange-hover", "bg", "text", "muted", "heading", "accent-text", "ok", "danger", "warn",
    "orb-orange-a", "orb-blue-a", "glass-rgb", "glass-a", "glass-strong-a", "glass-border", "tint", "shade", "hairline", "shadow", "shadow-sm",
    "glow", "blur", "solid", "solid-2", "drawer-bg", "scrim", "radius", "radius-lg", "radius-md", "radius-item", "radius-pill", "sidebar-w",
    "sidebar-w-collapsed", "font"];
  for (const t of ["dark", "light"] as const) for (const n of nomes) avz(t)(n);
  for (const n of ["bg", "text", "muted", "accent-text", "glass-a", "glass-strong-a", "tint", "shade"]) assert.match(kitClaro, new RegExp(`--avz-${n}:`), `claro redefine --avz-${n}`);
  assert.match(avz("dark")("font"), /--font-jakarta.*Plus Jakarta Sans/);
  assert.equal(avz("dark")("radius"), "22px");
  assert.equal(avz("dark")("radius-md"), "14px");
  assert.match(ler("src/app/layout.tsx"), /import "@\/styles\/avanteza-tokens\.css"/);
  // Mesmo arquivo do kit quando o repositório da Central está ao lado (máquina de desenvolvimento).
  const origem = path.resolve("../../agente-bastao-iel/packages/avanteza-kit/tokens.css");
  if (fs.existsSync(origem)) assert.ok(kit.endsWith(ler(origem)), "a cópia difere do kit: copie de novo");
});

test("tema do Tailwind mapeado para os tokens do kit (claro e escuro)", () => {
  for (const t of ["dark", "light"] as const) {
    const k = avz(t), v = tw(t);
    const iguais: Array<[string, string]> = [["foreground", k("text")], ["card-foreground", k("text")], ["popover-foreground", k("text")],
      ["muted-foreground", k("muted")], ["destructive-texto", k("danger")], ["ok-texto", k("ok")], ["aviso-texto", k("warn")],
      ["ring", k("accent-text")], ["laranja-texto", k("accent-text")], ["laranja", k("orange")], ["laranja-hover", k("orange-hover")],
      ["marinho", avz("dark")("navy")], ["creme", avz("dark")("cream")], ["areia", avz("dark")("sand")]];
    for (const [nome, cor] of iguais) {
      const val = t === "light" && !temaClaro.includes(`--${nome}:`) ? tw("dark")(nome) : v(nome);
      assert.ok(perto(hsl(val), hex(cor)), `${t} --${nome}: ${paraHex(hsl(val))} ≠ ${cor}`);
    }
    assert.ok(perto(hsl(v("card")), rgbTriplet(k("glass-rgb"))), `${t} --card é a cor do vidro`);
    const ca = Number(v("card-a"));
    assert.ok(ca >= Number(k("glass-a")) && ca <= Number(k("glass-strong-a")), `${t} --card-a entre glass-a e glass-strong-a`);
    assert.ok(perto(hsl(v("popover")), rgbaCor(k("solid-2"))), `${t} --popover é o vidro forte (solid-2)`);
    assert.ok(Number(v("popover-a")) >= 0.95, `${t} diálogos quase opacos`);
    assert.ok(perto(hsl(v("muted")), rgbTriplet(k("tint"))) && perto(hsl(v("accent")), rgbTriplet(k("tint"))), `${t} realces = --avz-tint`);
  }
  assert.ok(perto(hsl(tw("light")("background")), hex(avz("light")("bg"))), "claro: campo afundado em creme");
  assert.ok(perto(hsl(tw("dark")("background")), rgbTriplet(avz("dark")("shade"))), "escuro: campo afundado = --avz-shade");
  assert.ok(perto(hsl(tw("dark")("secondary")), hex(avz("dark")("navy-3"))) && perto(hsl(tw("light")("secondary")), hex(avz("dark")("sand"))));
  const cfg = ler("tailwind.config.ts");
  for (const n of ["card", "popover", "muted", "accent", "background"]) {
    assert.match(cfg, new RegExp(`"hsl\\(var\\(--${n}\\) / calc\\(<alpha-value> \\* var\\(--${n}-a\\)\\)\\)"`), `bg-${n} usa o alfa do tema`);
  }
  assert.match(cfg, /xl: "var\(--avz-radius\)"/);
  assert.match(cfg, /md: "var\(--avz-radius-md\)"/);
  assert.match(cfg, /vidro: "var\(--avz-shadow\)"/);
  assert.match(css, /html \{\s*background: var\(--avz-bg\)/, "fundo da página = --avz-bg (as orbes ficam por cima)");
  assert.match(css, /body::before[\s\S]*--avz-orb-orange-a[\s\S]*body::after[\s\S]*--avz-orb-blue-a/, "orbes de fundo");
});

// Pior caso do fundo em cada tema: o pico de cada orbe (cantos opostos, nunca se sobrepõem) e o fundo puro; vale o que der
// MENOS contraste. Por cima: vidro (bg-card), vidro dentro de vidro (cartão no palco), realce e campo afundado.
function superficies(t: "dark" | "light") {
  const k = avz(t), v = tw(t);
  const bg = hex(k("bg"));
  const bases = [bg, sobre(bg, hex(k("orange")), Number(k("orb-orange-a"))), sobre(bg, hex(k("blue")), Number(k("orb-blue-a")))];
  const camada = (cor: string, alfa: string) => [hsl(v(cor)), Number(v(alfa))] as const;
  const [card, ca] = camada("card", "card-a"), [pop, pa] = camada("popover", "popover-a"), [mut, ma] = camada("muted", "muted-a");
  const [acc, aa] = camada("accent", "accent-a"), [fld, fa] = camada("background", "background-a");
  return bases.map((base) => {
    const c1 = sobre(base, card, ca), c2 = sobre(c1, card, ca);
    return { base, cartao: c1, cartaoNoPalco: c2, popover: sobre(base, pop, pa), realce: sobre(c1, mut, ma), realceNoPalco: sobre(c2, mut, ma),
      hover: sobre(c1, acc, aa), campo: sobre(c1, fld, fa), campoNoPalco: sobre(c2, fld, fa) };
  });
}

for (const t of ["dark", "light"] as const) {
  test(`[${t}] texto sobre vidro, realce e campo: AA (4,5:1) no pior caso do fundo`, () => {
    const v = tw(t);
    const textos = ["foreground", "muted-foreground", "destructive-texto", "ok-texto", "aviso-texto"];
    for (const s of superficies(t)) {
      for (const [nome, sup] of Object.entries(s)) {
        for (const n of textos) {
          const r = contraste(hsl(v(n)), sup);
          assert.ok(r >= 4.5, `${t} --${n} sobre ${nome} (${paraHex(sup)}): ${r.toFixed(2)}`);
        }
      }
      // laranja como texto (links, ícones de destaque): no vidro, no palco, em realce/hover e em diálogos
      for (const nome of ["base", "cartao", "cartaoNoPalco", "popover", "realce", "hover"] as const) {
        const r = contraste(hsl(v("laranja-texto")), s[nome]);
        assert.ok(r >= 4.5, `${t} --laranja-texto sobre ${nome}: ${r.toFixed(2)}`);
      }
      // foco (anel de 2px): componente de interface, 3:1
      assert.ok(contraste(hsl(v("ring")), s.cartaoNoPalco) >= 3, `${t} anel de foco`);
    }
  });

  test(`[${t}] pares de preenchimento: botão, pílulas, perigo, laranja com texto marinho`, () => {
    const v = tw(t);
    const par = (fg: string, bg: string) => {
      const r = contraste(hsl(v(fg)), hsl(v(bg)));
      assert.ok(r >= 4.5, `${t} --${fg} sobre --${bg}: ${r.toFixed(2)}`);
    };
    par("primary-foreground", "primary");
    par("secondary-foreground", "secondary");
    par("destructive-foreground", "destructive");
    const marinho = hsl(tw("dark")("marinho"));
    for (const n of ["laranja", "laranja-hover"]) {
      const cor = hsl(t === "light" ? v(n) : tw("dark")(n));
      assert.ok(contraste(marinho, cor) >= 4.5, `marinho sobre --${n}`);
    }
    // botão padrão sobre o vidro (o botão tem de se destacar do fundo: 3:1)
    for (const s of superficies(t)) assert.ok(contraste(hsl(v("primary")), s.cartaoNoPalco) >= 3, `${t} botão padrão visível`);
  });
}

test("laranja: preenchimento com texto marinho; como texto só --laranja-texto (laranja puro sobre claro reprova)", () => {
  const laranja = hex(avz("dark")("orange")), creme = hex(avz("dark")("cream"));
  assert.ok(contraste(laranja, creme) < 3 && contraste([255, 255, 255], laranja) < 3, "por isso a regra: laranja puro não é texto nem fundo de texto claro");
  for (const f of telas()) {
    const s = ler(f);
    assert.ok(!/\btext-laranja(?![\w-])/.test(s), `${f}: laranja puro como cor de texto (use text-laranja-texto)`);
    assert.ok(!/(?<![\w:-])(text|fill|stroke)-orange-[3-5]00\b/.test(s), `${f}: laranja do Tailwind como texto`);
    assert.ok(!/bg-laranja[^"`]*text-(white|creme|primary-foreground)|text-(white|creme|primary-foreground)[^"`]*bg-laranja(?![-\w])/.test(s), `${f}: texto claro sobre laranja`);
  }
  assert.doesNotMatch(css, /(?<![-\w])color:\s*var\(--avz-orange\)/, "CSS: laranja puro como cor de texto");
});

test("fonte: Plus Jakarta Sans via next/font em tudo (nada de Manrope, Inter ou Poppins)", () => {
  const layout = ler("src/app/layout.tsx");
  assert.match(layout, /import \{ Plus_Jakarta_Sans \} from "next\/font\/google"/);
  assert.match(layout, /variable: "--font-jakarta"/);
  assert.match(css, /font-family: var\(--avz-font\)/);
  assert.match(ler("tailwind.config.ts"), /sans: \["var\(--font-jakarta\)", "Plus Jakarta Sans"/);
  for (const f of [...telas(), "tailwind.config.ts", "public/manifest.json", "public/offline.html"]) {
    const s = ler(f);
    for (const p of [/manrope/i, /poppins/i, /font-inter|\bInter\b/]) assert.ok(!p.test(s), `${f}: ${p}`);
  }
});

// Só a interface: rotas de API e bibliotecas de servidor não têm classe de estilo.
function fontes(dir = "src"): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fontes(`${dir}/${e.name}`) : /\.(tsx?|css)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
function telas() { return fontes().filter((f) => /^src\/(app\/(?!api\/)|components\/|hooks\/|lib\/prospeccao\/status\.ts)/.test(f)); }

// Hex permitido só nos tokens do kit e nestes arquivos (marcas de terceiros e séries de gráfico, que têm cor por
// definição). A lista só encolhe: tela nova usa tokens.
const HEX_PERMITIDO: Record<string, string> = {
  "src/app/checkout/[id]/page.tsx": "checkout público antigo, fora do menu (visual próprio)",
  "src/app/crm/agent/page.tsx": "prévia de balão do WhatsApp (verde da marca)",
  "src/app/crm/agents/chat/[accountId]/page.tsx": "prévia de balão do WhatsApp",
  "src/app/crm/campaign/new/[orgId]/page.tsx": "prévia do WhatsApp (cores da marca)",
  "src/app/crm/campaign/view/[campaignId]/page.tsx": "série de gráfico",
  "src/app/crm/campaigns/page.tsx": "série de gráfico",
  "src/app/crm/calendar/page.tsx": "série de indicadores",
  "src/app/crm/disparos/page.tsx": "cor padrão de coluna do quadro (dado)",
  "src/app/crm/metrics/page.tsx": "séries de gráfico",
  "src/app/crm/settings/page.tsx": "paleta de cores de coluna (dado escolhido pela pessoa)",
  "src/components/financeiro/DreTab.tsx": "séries de gráfico",
  "src/components/financeiro/OverviewTab.tsx": "séries de gráfico",
  "src/components/financeiro/ProjecaoTab.tsx": "séries de gráfico",
  "src/components/prospeccao/Resultados.tsx": "séries de gráfico",
};

test("sem hex soltos: cores das telas vêm dos tokens (exceções: marcas e gráficos listados)", () => {
  for (const f of telas()) {
    if (f in HEX_PERMITIDO) continue;
    const s = ler(f).replace(/THEME_COLORS\.\w+/g, "");
    const m = s.match(/#[0-9A-Fa-f]{3,8}\b(?![\w-])/);
    assert.ok(!m, `${f}: cor fixa ${m?.[0]} (use um token do tema)`);
  }
  for (const f of Object.keys(HEX_PERMITIDO)) assert.ok(fs.existsSync(f) && /#[0-9A-Fa-f]{6}/.test(ler(f)), `${f}: tire da lista de exceções`);
  assert.doesNotMatch(css, /#[0-9A-Fa-f]{3,8}\b/, "globals.css: só tokens (hex mora no kit)");
});

test("superfícies: vidro com fallback sólido, diálogos/menus no vidro forte, nada de hsl() cru em token com alfa", () => {
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\.vidro \{ background-color: var\(--avz-solid\)/);
  assert.match(css, /\.vidro \{[^}]*backdrop-filter: blur\(var\(--avz-blur\)\)/);
  assert.match(css, /\.vidro-forte \{[^}]*hsl\(var\(--popover\) \/ var\(--popover-a\)\)/);
  assert.match(css, /dialog\.bg-card, \[role="dialog"\]\.bg-card/, "modais usam o vidro forte mesmo com bg-card");
  assert.match(css, /@media print \{\s*html:root\[data-theme\]/, "impressão (proposta em PDF) sempre no claro");
  assert.match(ler("src/components/ui/card.tsx"), /"vidro rounded-xl/);
  assert.match(ler("src/components/ui/dialog.tsx"), /vidro-forte p-6/);
  assert.match(ler("src/components/ui/dropdown-menu.tsx"), /rounded-lg vidro-forte/);
  assert.match(ler("src/components/ui/select.tsx"), /rounded-lg vidro-forte/);
  for (const f of telas()) {
    const s = ler(f);
    assert.ok(!/hsl\(var\(--(card|muted|accent|background)\)\)/.test(s), `${f}: hsl(var(--x)) cru num token com alfa (use / var(--x-a))`);
    assert.ok(!/(?<![\w:-])shadow-(sm|md|lg|xl|2xl|inner)\b|(?<![\w-])shadow(?=[\s"'`])/.test(s), `${f}: sombra dura (use shadow-vidro/suave/brilho)`);
    assert.ok(!/\b(bg|text|border)-(gray|slate|zinc)-\d/.test(s), `${f}: cinza frio (use muted/border/foreground)`);
    assert.ok(!/(?<![\w:-])bg-white(?![\w/-])/.test(s), `${f}: bg-white (use bg-card)`);
  }
});

test("tema claro/escuro: mesmo botão sol/lua e mesma chave da Central, aplicado antes da pintura", () => {
  const tema = ler("src/lib/theme/tema.ts");
  assert.match(tema, /THEME_KEY = "avanteza-tema"/);
  assert.match(tema, /SIDEBAR_KEY = "avanteza-menu"/);
  assert.match(tema, /prefers-color-scheme: light/);
  const layout = ler("src/app/layout.tsx");
  assert.match(layout, /__html: THEME_INIT_SCRIPT \+ SIDEBAR_INIT_SCRIPT/);
  assert.match(layout, /suppressHydrationWarning/);
  const botao = ler("src/components/ui/theme-switcher.tsx");
  assert.match(botao, /aria-label=\{label\}/);
  assert.match(botao, /Mudar para o tema (claro|escuro)/);
  for (const f of ["src/components/layout/Sidebar.tsx", "src/components/layout/Header.tsx", "src/app/login/form-login.tsx"]) assert.match(ler(f), /<ThemeToggle/, f);
  for (const f of telas()) assert.ok(!/from "next-themes"/.test(ler(f)), `${f}: next-themes (o tema é do script do kit)`);
});

test("script de tema: escolha lembrada vence, sem escolha segue o sistema, storage bloqueado não quebra", async () => {
  const { THEME_INIT_SCRIPT, SIDEBAR_INIT_SCRIPT } = await import("../src/lib/theme/tema");
  const rodar = (script: string, store: Record<string, string> | "falha", cookie: string, claro: boolean) => {
    const attrs: Record<string, string> = {}; const classes = new Set<string>();
    const g = {
      document: { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } },
      window: { matchMedia: () => ({ matches: claro }) },
      localStorage: store === "falha" ? { getItem() { throw new Error("bloqueado"); } } : { getItem: (k: string) => store[k] ?? null },
    };
    new Function("document", "window", "localStorage", script)(g.document, g.window, g.localStorage);
    return { tema: attrs["data-theme"], dark: classes.has("dark"), menu: attrs["data-sidebar"] };
  };
  assert.deepEqual(rodar(THEME_INIT_SCRIPT, { "avanteza-tema": "light" }, "", false), { tema: "light", dark: false, menu: undefined });
  assert.deepEqual(rodar(THEME_INIT_SCRIPT, {}, "avanteza-tema=dark", true), { tema: "dark", dark: true, menu: undefined });
  assert.equal(rodar(THEME_INIT_SCRIPT, { theme: "light" }, "", false).tema, "light", "escolha antiga do next-themes é respeitada");
  assert.equal(rodar(THEME_INIT_SCRIPT, {}, "", true).tema, "light", "sem escolha: sistema claro");
  assert.equal(rodar(THEME_INIT_SCRIPT, "falha", "", false).tema, "dark", "storage bloqueado: segue o sistema");
  assert.equal(rodar(SIDEBAR_INIT_SCRIPT, { "avanteza-menu": "collapsed" }, "", false).menu, "collapsed");
  assert.equal(rodar(SIDEBAR_INIT_SCRIPT, "falha", "avanteza-menu=collapsed", false).menu, "collapsed");
  assert.equal(rodar(SIDEBAR_INIT_SCRIPT, {}, "", false).menu, undefined);
});

test("menu lateral no desenho da Central: grupos, item ativo laranja, recolhível, gaveta, atalho da Central e zona /comercial", () => {
  const sb = ler("src/components/layout/Sidebar.tsx");
  assert.match(sb, /role="group"/);
  assert.match(sb, /aria-current=\{isActive\(item\.href\) \? "page" : undefined\}/);
  assert.match(sb, /hrefNaZona\(h, pathname\)/, "sob /comercial os links ficam na zona");
  assert.match(sb, /href=\{api\("\/api\/sso\/central"\)\}[^>]*>[\s\S]{0,80}<span className="sb-text">Central<\/span>/, "atalho Central pelo login único");
  assert.match(sb, /aria-pressed=\{recolhido\}/);
  assert.match(sb, /lembrar\(SIDEBAR_KEY, prox\)/);
  assert.match(css, /\.sb-link\[aria-current="page"\] \{ background: var\(--avz-orange\); color: var\(--avz-navy\)/);
  assert.match(css, /:root\[data-sidebar="collapsed"\] \{ --avz-sidebar-w: var\(--avz-sidebar-w-collapsed\); \}/);
  assert.match(css, /\.shell\.open \.sidebar \{ transform: none/, "gaveta no celular");
  const layout = ler("src/app/crm/layout.tsx");
  assert.match(layout, /className="scrim"/);
  assert.match(layout, /e\.key === "Escape"/);
});

test("marca: logotipo com o ponto laranja, título do app e sem a identidade anterior (NEXO, azul/grafite)", () => {
  assert.match(ler("src/components/ui/logo.tsx"), /avanteza<span className="logo-ponto"/);
  assert.match(css, /\.logo-ponto \{[^}]*border-radius: 50%; background: var\(--avz-orange\)/);
  assert.match(ler("src/app/layout.tsx"), /title: "Vendedor IA · Avanteza"/);
  const proibidos = [/#2448FF/i, /#FF7043/i, /#F6F5F0/i, /#18191D/i, /#686A73/i, /#004c3f/i, /#F5C400/i, /#00B894/i,
    /\bavz-(azul|laranja|bq|grafite|cinza)\b/, /\b(bg|text|border|ring)-emerald-/, /primary-texto/];
  for (const f of [...telas(), "tailwind.config.ts", "public/manifest.json", "public/offline.html"]) {
    const s = ler(f);
    for (const p of proibidos) assert.ok(!p.test(s), `${f}: ${p}`);
  }
  for (const f of ["src/app/layout.tsx", "src/app/login/form-login.tsx", "src/components/layout/Sidebar.tsx", "public/manifest.json", "public/offline.html"]) {
    assert.ok(!/nexo/i.test(ler(f).replace(/nexo-v\d/g, "")), `${f}: ainda mostra a marca NEXO`);
  }
});
