// Regras da identidade Avanteza v2.0 como teste: se alguém trocar um token e quebrar o contraste,
// trouxer de volta a paleta antiga, uma sombra ou um degradê, falha.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PALETA } from "../tailwind.config";

const { marinho: MARINHO, marinho2: MARINHO2, creme: CREME, areia: AREIA, laranja: LARANJA, laranjaHover: LARANJA_HOVER, superficie: BRANCO, suave: SUAVE, ok: OK, perigo: PERIGO, perigoTexto: PERIGO_TEXTO } = PALETA;

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const raiz = process.cwd();
const ler = (f: string) => fs.readFileSync(path.join(raiz, f), "utf8");
function fontes(dir = "src"): string[] {
  return fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fontes(`${dir}/${e.name}`) : /\.(tsx?|css)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}

test("a paleta é a da identidade v2.0", () => {
  assert.deepEqual(
    { MARINHO, MARINHO2, CREME, AREIA, LARANJA, LARANJA_HOVER, BRANCO, OK, PERIGO },
    { MARINHO: "#0B1B33", MARINHO2: "#132A4C", CREME: "#F5F0E6", AREIA: "#EAD9C2", LARANJA: "#FF6A1F", LARANJA_HOVER: "#E85A12", BRANCO: "#FFFFFF", OK: "#047857", PERIGO: "#DC2626" },
  );
});

test("combinações usadas na interface passam em AA (4,5:1)", () => {
  const aprovadas: Array<[string, string, string]> = [
    ["marinho sobre creme", MARINHO, CREME], ["marinho sobre branco", MARINHO, BRANCO], ["marinho sobre areia", MARINHO, AREIA],
    ["creme sobre marinho", CREME, MARINHO], ["creme sobre marinho 2", CREME, MARINHO2], ["areia sobre marinho", AREIA, MARINHO],
    ["marinho sobre laranja", MARINHO, LARANJA], ["marinho sobre laranja (hover)", MARINHO, LARANJA_HOVER], ["laranja sobre marinho", LARANJA, MARINHO],
    ["texto suave sobre creme", SUAVE, CREME], ["texto suave sobre branco", SUAVE, BRANCO],
    ["ok sobre creme", OK, CREME], ["ok sobre branco", OK, BRANCO],
    ["texto de perigo sobre creme", PERIGO_TEXTO, CREME], ["texto de perigo sobre branco", PERIGO_TEXTO, BRANCO], ["branco sobre perigo", BRANCO, PERIGO],
  ];
  for (const [nome, fg, bg] of aprovadas) assert.ok(contraste(fg, bg) >= 4.5, `${nome}: ${contraste(fg, bg).toFixed(2)}`);
  // Sobre areia o texto é marinho: o suave fica abaixo de 4,5:1.
  assert.ok(contraste(SUAVE, AREIA) < 4.5);
  for (const f of fontes()) assert.ok(!/bg-areia[^"`]*text-suave|text-suave[^"`]*bg-areia/.test(ler(f)), `${f}: texto suave sobre areia`);
});

test("laranja não é cor de texto sobre fundo claro, nem fundo para texto claro", () => {
  for (const [fg, bg] of [[LARANJA, CREME], [LARANJA, BRANCO], [BRANCO, LARANJA], [CREME, LARANJA]]) assert.ok(contraste(fg, bg) < 3, `${fg} sobre ${bg}`);
  // text-laranja só onde o fundo é marinho (os colchetes do título na tela de login).
  const comTextoLaranja = fontes().filter((f) => /\btext-laranja\b/.test(ler(f)));
  assert.deepEqual(comTextoLaranja, ["src/app/login/form-login.tsx"]);
  for (const f of fontes()) assert.ok(!/bg-laranja[^"`]*text-(creme|superficie)|text-(creme|superficie)[^"`]*bg-laranja(?!-)/.test(ler(f)), `${f}: laranja com texto claro`);
});

test("cores só no tema: nenhum hex solto, nem a paleta antiga, nos componentes", () => {
  const antigas = /#2448FF|#FF7043|#F6F5F0|#18191D|#686A73|\b(bg|text|border|ring)-(azul|grafite|bq|cinza|linha|critico)\b|bg-white|font-inter/i;
  for (const f of [...fontes(), "tailwind.config.ts"]) {
    const s = ler(f);
    assert.ok(!antigas.test(s), `${f}: resto da identidade anterior`);
    if (f !== "tailwind.config.ts") assert.ok(!/#[0-9a-f]{6}\b/i.test(s), `${f}: hex solto (use os tokens do tema)`);
  }
});

test("forma: sem sombras, sem degradês, cantos de 6px (ou pílula)", () => {
  for (const f of fontes()) {
    const s = ler(f);
    assert.ok(!/\bshadow-(sm|md|lg|xl|2xl|inner|\[)|box-shadow|drop-shadow/.test(s), `${f}: sombra`);
    assert.ok(!/bg-gradient|-gradient\(/.test(s), `${f}: degradê`);
    assert.ok(!/\brounded(-[trbl]{1,2})?-(lg|xl|2xl|3xl|\[)/.test(s), `${f}: canto fora do padrão (use rounded-md ou rounded-full)`);
  }
});

test("fonte e logotipo: Manrope em tudo e o quadrado laranja no logo", () => {
  const layout = ler("src/app/layout.tsx");
  assert.match(layout, /Manrope/);
  assert.doesNotMatch(layout, /\bInter\b/);
  assert.match(ler("src/components/logo.tsx"), /avanteza<span className="logo-ponto"/);
  assert.match(ler("src/app/globals.css"), /\.logo-ponto \{[^}]*background: var\(--laranja\)/);
});
