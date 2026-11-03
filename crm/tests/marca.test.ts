// Regras de cor da identidade Avanteza como teste: se alguém trocar um token e quebrar o contraste, falha.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const AZUL = "#2448FF", LARANJA = "#FF7043", BQ = "#F6F5F0", GRAFITE = "#18191D", CINZA = "#686A73", BRANCO = "#FFFFFF";

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("combinações aprovadas da marca passam em AA (4,5:1)", () => {
  const aprovadas: Array<[string, string, string]> = [
    ["branco quente sobre azul", BQ, AZUL], ["grafite sobre branco quente", GRAFITE, BQ], ["azul sobre branco quente", AZUL, BQ],
    ["grafite sobre laranja", GRAFITE, LARANJA], ["cinza de apoio sobre branco quente", CINZA, BQ], ["cinza de apoio sobre branco", CINZA, BRANCO],
    ["azul sobre branco", AZUL, BRANCO], ["grafite sobre branco", GRAFITE, BRANCO],
  ];
  for (const [nome, fg, bg] of aprovadas) assert.ok(contraste(fg, bg) >= 4.5, `${nome}: ${contraste(fg, bg).toFixed(2)}`);
});

test("combinações que a marca manda evitar realmente reprovam (laranja não é cor de texto)", () => {
  for (const [fg, bg] of [[LARANJA, BQ], [LARANJA, AZUL], [LARANJA, BRANCO], [BQ, LARANJA]]) assert.ok(contraste(fg, bg) < 3, `${fg} sobre ${bg}`);
});

test("globals.css e tailwind.config usam exatamente a paleta oficial", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").toLowerCase();
  for (const cor of [AZUL, LARANJA, BQ, GRAFITE, CINZA]) assert.ok(css.includes(cor.toLowerCase()), `falta ${cor} em globals.css`);
  assert.ok(!/#[0-9a-f]{6}/i.test(fs.readFileSync(path.join(process.cwd(), "src/components/cartao.tsx"), "utf8")), "componentes usam tokens, não hex solto");
});
