// Chamadas da API pelo navegador passam por apiUrl() (src/lib/api-url.ts): sob /comercial elas vão para
// /comercial/api/… (endereço sob a Central). Proíbe fetch("/api…") escrito à mão no resto do código.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { apiUrl, prefixoDaPagina } from "@/lib/api-url";

const SRC = path.join(process.cwd(), "src");
const HELPER = path.join("src", "lib", "api-url.ts");
const arquivos = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? arquivos(p) : /\.(ts|tsx|js|jsx)$/.test(e.name) ? [p] : [];
});

test("nenhum fetch(\"/api…\") fora do helper apiUrl", () => {
  const achados: string[] = [];
  for (const arq of arquivos(SRC)) {
    const rel = path.relative(process.cwd(), arq);
    if (rel === HELPER) continue;
    const fonte = fs.readFileSync(arq, "utf8");
    for (const m of fonte.matchAll(/\bfetch\(\s*['"`]\/api/g)) {
      achados.push(`${rel}:${fonte.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(achados, [], "use fetch(apiUrl(\"/api/…\"))");
  assert.match(fs.readFileSync(path.join(SRC, "lib", "graphql", "client.ts"), "utf8"), /uri: \(\) => apiUrl\("\/api\/graphql"\)/, "Apollo também passa pelo helper");
});

test("apiUrl: /api no domínio do Vendedor IA, /comercial/api nas páginas do Comercial", () => {
  assert.equal(apiUrl("/api/graphql", "/crm/conversations"), "/api/graphql");
  assert.equal(apiUrl("/api/comercial/quadro?funilId=1", "/comercial/oportunidades"), "/comercial/api/comercial/quadro?funilId=1");
  assert.equal(apiUrl("/api/x", "/comercial"), "/comercial/api/x");
  assert.equal(apiUrl("/api/x", "/comercialx"), "/api/x", "prefixo exato");
  assert.equal(apiUrl("comercial/quadro", "/"), "/api/comercial/quadro");
  assert.equal(prefixoDaPagina("/comercial/p/abc"), "/comercial");
  assert.equal(prefixoDaPagina(), "", "fora do navegador: sem prefixo");
});
