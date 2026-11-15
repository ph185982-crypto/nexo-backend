// Identidade Avanteza v2.0 no Vendedor IA: paleta e contraste dos tokens do tema, forma (sem sombras,
// sem degradês, raio de 6px), fonte única e cores/nomes da identidade anterior proibidos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function hslParaHex(hsl: string): string {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const perto = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);

const css = fs.readFileSync("src/app/globals.css", "utf8");
function tokens(bloco: ":root" | ".dark"): Record<string, string> {
  const ini = css.indexOf(`${bloco} {`);
  const corpo = css.slice(ini, css.indexOf("}", ini));
  const out: Record<string, string> = {};
  for (const m of corpo.matchAll(/--([a-z0-9-]+):\s*([\d.]+ [\d.]+% [\d.]+%)\s*;/g)) out[m[1]] = hslParaHex(m[2]);
  return out;
}
function fontes(dir = "src"): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fontes(`${dir}/${e.name}`) : /\.(tsx?|css)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
// Só a interface: rotas de API e bibliotecas de servidor não têm classe de estilo.
const telas = () => fontes().filter((f) => /^src\/(app\/(?!api\/)|components\/|lib\/prospeccao\/status\.ts)/.test(f));

const MARINHO = "#0b1b33", MARINHO2 = "#132a4c", CREME = "#f5f0e6", AREIA = "#ead9c2", LARANJA = "#ff6a1f", SUAVE = "#55637a", PERIGO = "#dc2626";
const PARES = [["foreground", "background"], ["foreground", "card"], ["card-foreground", "card"], ["popover-foreground", "popover"],
  ["primary-foreground", "primary"], ["primary", "background"], ["primary", "card"], ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "muted"], ["foreground", "muted"],
  ["accent-foreground", "accent"], ["destructive-foreground", "destructive"], ["destructive-texto", "background"], ["destructive-texto", "card"],
  ["sidebar-fg", "sidebar-bg"]];

test("tema claro (padrão) usa a paleta v2.0 e passa em AA", () => {
  const t = tokens(":root");
  for (const [nome, hex] of [["background", CREME], ["foreground", MARINHO], ["card", "#ffffff"], ["primary", MARINHO], ["primary-foreground", CREME],
    ["secondary", AREIA], ["border", AREIA], ["muted-foreground", SUAVE], ["laranja", LARANJA], ["ring", LARANJA], ["destructive", PERIGO],
    ["sidebar-bg", MARINHO], ["marinho", MARINHO], ["marinho-2", MARINHO2], ["creme", CREME], ["areia", AREIA]]) {
    assert.ok(perto(t[nome], hex), `${nome}: ${t[nome]} ≠ ${hex}`);
  }
  for (const [fg, bg] of PARES) assert.ok(contraste(t[fg], t[bg]) >= 4.5, `claro ${fg} sobre ${bg}: ${contraste(t[fg], t[bg]).toFixed(2)}`);
  assert.match(fs.readFileSync("src/app/layout.tsx", "utf8"), /defaultTheme="light"/, "o tema padrão é o claro");
  assert.match(css, /--radius:\s*0\.375rem/, "raio de 6px");
});

test("tema escuro (opcional) é marinho com texto creme e passa em AA", () => {
  const t = tokens(".dark");
  for (const [nome, hex] of [["background", MARINHO], ["card", MARINHO2], ["foreground", CREME], ["laranja", LARANJA], ["ring", LARANJA]]) {
    assert.ok(perto(t[nome], hex), `${nome}: ${t[nome]} ≠ ${hex}`);
  }
  for (const [fg, bg] of PARES) assert.ok(contraste(t[fg], t[bg]) >= 4.5, `escuro ${fg} sobre ${bg}: ${contraste(t[fg], t[bg]).toFixed(2)}`);
});

test("laranja é preenchimento com texto marinho — nunca cor de texto nem fundo de texto claro", () => {
  assert.ok(contraste(MARINHO, LARANJA) >= 4.5, "marinho sobre laranja");
  assert.ok(contraste(MARINHO, "#e85a12") >= 4.5, "marinho sobre laranja (hover)");
  assert.ok(contraste("#ffffff", LARANJA) < 3 && contraste(LARANJA, CREME) < 3, "branco sobre laranja e laranja sobre creme reprovam");
  for (const f of telas()) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/\btext-laranja\b/.test(s), `${f}: laranja como cor de texto`);
    assert.ok(!/bg-laranja[^"`]*text-(white|creme|primary-foreground)|text-(white|creme|primary-foreground)[^"`]*bg-laranja(?!-)/.test(s), `${f}: texto claro sobre laranja`);
  }
});

test("sem a identidade anterior: azul/grafite, verde-petróleo, Inter, Poppins e a marca NEXO na interface", () => {
  const arquivos = [...telas(), "tailwind.config.ts", "public/manifest.json", "public/offline.html"];
  const proibidos = [/#2448FF/i, /#FF7043/i, /#F6F5F0/i, /#18191D/i, /#686A73/i, /#004c3f/i, /#F5C400/i, /#00B894/i, /poppins/i, /font-inter|\bInter\b/,
    /\bavz-(azul|laranja|bq|grafite|cinza)\b/, /\b(bg|text|border|ring)-emerald-/, /primary-texto/];
  for (const f of arquivos) {
    const s = fs.readFileSync(f, "utf8");
    for (const p of proibidos) assert.ok(!p.test(s), `${f}: ${p}`);
  }
  for (const f of ["src/app/layout.tsx", "src/app/login/form-login.tsx", "src/components/layout/Sidebar.tsx", "public/manifest.json", "public/offline.html"]) {
    assert.ok(!/nexo/i.test(fs.readFileSync(f, "utf8").replace(/nexo-v\d/g, "")), `${f}: ainda mostra a marca NEXO`);
  }
  assert.match(fs.readFileSync("src/app/layout.tsx", "utf8"), /title: "Vendedor IA · Avanteza"/);
  assert.match(fs.readFileSync("src/components/ui/logo.tsx", "utf8"), /avanteza<span className="logo-ponto"/);
  assert.match(css, /\.logo-ponto \{[^}]*background: hsl\(var\(--laranja\)\)/, "o ponto do logo é o quadrado laranja");
});

test("forma: sem sombras, sem degradês, sem cantos maiores que o raio do tema", () => {
  for (const f of telas()) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/(?<![\w-])shadow(-(sm|md|lg|xl|2xl|inner|\[))?(?=[\s"'`])|box-shadow|boxShadow|drop-shadow/.test(s), `${f}: sombra`);
    assert.ok(!/bg-gradient|-gradient\(/.test(s), `${f}: degradê`);
    assert.ok(!/\brounded(-[trbl]{1,2})?-(xl|2xl|3xl)\b/.test(s), `${f}: canto fora do padrão (use rounded-lg/md ou rounded-full)`);
  }
});

test("neutros vêm do tema: sem cinza frio (gray/slate/zinc) nem branco chapado como fundo de cartão", () => {
  for (const f of telas()) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/\b(bg|text|border)-(gray|slate|zinc)-\d/.test(s), `${f}: cinza frio (use muted/border/foreground)`);
    assert.ok(!/(?<![\w:-])bg-white(?![\w/-])/.test(s), `${f}: bg-white (use bg-card)`);
  }
});
