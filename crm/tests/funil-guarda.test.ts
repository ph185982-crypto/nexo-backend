// Regra: só src/lib/funil/mover.ts cria oportunidade ou troca a etapa dela.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.join(process.cwd(), "src");
const CENTRAL = path.join("src", "lib", "funil", "mover.ts");
const arquivos = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

function escritas(arquivo: string) {
  const sf = ts.createSourceFile(arquivo, fs.readFileSync(arquivo, "utf8"), ts.ScriptTarget.Latest, true);
  const achados: Array<{ metodo: string; linha: number }> = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const alvo = n.expression.expression;
      const metodo = n.expression.name.text;
      if (ts.isPropertyAccessExpression(alvo) && alvo.name.text === "oportunidade" && ["create", "createMany", "update", "updateMany", "upsert"].includes(metodo)) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            const nome = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : "";
            if (!["data", "create", "update"].includes(nome)) continue;
            const texto = (prop as ts.PropertyAssignment).initializer?.getText(sf) ?? "";
            if (/\b(etapaId|funilId|etapa|funil|status|encerradaEm|etapaDesdeEm)\b/.test(texto)) {
              achados.push({ metodo, linha: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
            }
          }
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return achados;
}

test("só funil/mover.ts grava etapa, funil ou status de uma oportunidade", () => {
  const violacoes: string[] = [];
  for (const arq of arquivos(SRC)) {
    const rel = path.relative(process.cwd(), arq);
    if (rel === CENTRAL) continue;
    for (const w of escritas(arq)) violacoes.push(`${rel}:${w.linha} oportunidade.${w.metodo}() grava etapa/funil/status direto — use moverOportunidade ou criarOportunidade`);
  }
  assert.deepEqual(violacoes, []);
});
