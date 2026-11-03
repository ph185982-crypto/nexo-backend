// Identidade Avanteza no Vendedor IA: contraste dos tokens do tema e cores proibidas.
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

const css = fs.readFileSync("src/app/globals.css", "utf8");
function tokens(bloco: ":root" | ".dark"): Record<string, string> {
  const ini = css.indexOf(`${bloco} {`);
  const corpo = css.slice(ini, css.indexOf("}", ini));
  const out: Record<string, string> = {};
  for (const m of corpo.matchAll(/--([a-z-]+):\s*([\d.]+ [\d.]+% [\d.]+%)\s*;/g)) out[m[1]] = hslParaHex(m[2]);
  return out;
}

test("tema claro usa a paleta oficial e passa em AA", () => {
  const t = tokens(":root");
  const perto = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
  assert.ok(perto(t.primary, "#2448ff"), `primary ${t.primary}`);
  assert.ok(perto(t.background, "#f6f5f0"), `background ${t.background}`);
  assert.ok(perto(t.foreground, "#18191d"), `foreground ${t.foreground}`);
  assert.ok(perto(t["muted-foreground"], "#686a73"), `muted ${t["muted-foreground"]}`);
  for (const [fg, bg] of [["foreground", "background"], ["foreground", "card"], ["primary", "background"], ["primary-foreground", "primary"], ["muted-foreground", "background"], ["muted-foreground", "card"], ["sidebar-fg", "sidebar-bg"], ["accent-foreground", "accent"]]) {
    assert.ok(contraste(t[fg], t[bg]) >= 4.5, `claro ${fg} sobre ${bg}: ${contraste(t[fg], t[bg]).toFixed(2)}`);
  }
});

test("tema escuro (padrão) passa em AA, inclusive texto em azul", () => {
  const t = tokens(".dark");
  for (const [fg, bg] of [["foreground", "background"], ["foreground", "card"], ["primary-texto", "background"], ["primary-texto", "card"], ["primary-foreground", "primary"], ["muted-foreground", "background"], ["muted-foreground", "card"], ["sidebar-fg", "sidebar-bg"], ["accent-foreground", "accent"]]) {
    assert.ok(contraste(t[fg], t[bg]) >= 4.5, `escuro ${fg} sobre ${bg}: ${contraste(t[fg], t[bg]).toFixed(2)}`);
  }
  assert.match(css, /\.dark \.text-primary/, "texto azul no escuro usa o tom claro");
});

test("sem a marca antiga: verde-petróleo, amarelo e Poppins saíram", () => {
  const arquivos = ["tailwind.config.ts", "src/app/globals.css", "src/app/layout.tsx", "public/manifest.json", "public/offline.html", "src/app/checkout/[id]/page.tsx"];
  for (const f of arquivos) {
    const s = fs.readFileSync(f, "utf8");
    for (const proibido of [/#004c3f/i, /#F5C400/i, /#00B894/i, /poppins/i, /#10b981.*theme|theme_color.*#10b981/i]) assert.ok(!proibido.test(s), `${f}: ${proibido}`);
  }
  assert.ok(!/linear-gradient/.test(fs.readFileSync("src/app/checkout/[id]/page.tsx", "utf8")), "sem gradiente");
});

test("laranja só como preenchimento, nunca como cor de texto", () => {
  const ruins: string[] = [];
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) varrer(p);
      else if (/\.(tsx|ts|css)$/.test(e.name) && /text-avz-laranja|color:\s*['"]?#FF7043/i.test(fs.readFileSync(p, "utf8"))) ruins.push(p);
    }
  };
  varrer("src");
  assert.deepEqual(ruins, []);
  assert.ok(contraste("#18191D", "#FF7043") >= 4.5, "grafite sobre laranja");
});
