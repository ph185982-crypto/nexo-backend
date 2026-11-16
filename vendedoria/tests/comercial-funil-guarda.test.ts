// Regras do Comercial (portadas de crm/tests/funil-guarda.test.ts e estendidas):
//  1. só src/lib/comercial/funil/mover.ts cria oportunidade ou grava etapa/funil/status/encerramento dela;
//  2. só src/lib/crm/historico-etapa.ts grava Lead.kanbanColumnId de um lead existente (aplicarMudancaDeEtapa);
//     no Comercial, só o mover chama aplicarMudancaDeEtapa (o Lead anda junto com a oportunidade, nunca por fora).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.join(process.cwd(), "src");
const MOVER = path.join("src", "lib", "comercial", "funil", "mover.ts");
const HISTORICO = path.join("src", "lib", "crm", "historico-etapa.ts");
const arquivos = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

/** Chamadas `<algo>.<modelo>.<metodo>(...)`: devolve método, linha e o texto de data/create/update. */
function chamadas(arquivo: string, modelo: string) {
  const sf = ts.createSourceFile(arquivo, fs.readFileSync(arquivo, "utf8"), ts.ScriptTarget.Latest, true);
  const achados: Array<{ metodo: string; linha: number; dados: string }> = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const alvo = n.expression.expression;
      const metodo = n.expression.name.text;
      if (ts.isPropertyAccessExpression(alvo) && alvo.name.text === modelo && ["create", "createMany", "update", "updateMany", "upsert"].includes(metodo)) {
        const arg = n.arguments[0];
        let dados = "";
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            const nome = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : "";
            if (["data", "create", "update"].includes(nome)) dados += (prop as ts.PropertyAssignment).initializer?.getText(sf) ?? "";
          }
        } else if (arg) dados = arg.getText(sf); // objeto montado fora: conta como suspeito
        achados.push({ metodo, linha: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, dados });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return achados;
}

test("só comercial/funil/mover.ts cria oportunidade ou grava etapa, funil, status ou encerramento dela", () => {
  const violacoes: string[] = [];
  for (const arq of arquivos(SRC)) {
    const rel = path.relative(process.cwd(), arq);
    if (rel === MOVER) continue;
    for (const c of chamadas(arq, "comOportunidade")) {
      if (["create", "createMany", "upsert"].includes(c.metodo)) violacoes.push(`${rel}:${c.linha} comOportunidade.${c.metodo}() cria oportunidade — use criarOportunidade`);
      else if (/\b(etapaId|funilId|etapa|funil|status|encerradaEm|etapaDesdeEm|motivoId)\b/.test(c.dados)) violacoes.push(`${rel}:${c.linha} comOportunidade.${c.metodo}() grava etapa/funil/status — use moverOportunidade`);
    }
  }
  assert.deepEqual(violacoes, []);
});

test("Lead.kanbanColumnId: só historico-etapa.ts troca a coluna; no Comercial só o mover chama aplicarMudancaDeEtapa", () => {
  const violacoes: string[] = [];
  for (const arq of arquivos(SRC)) {
    const rel = path.relative(process.cwd(), arq);
    const fonte = fs.readFileSync(arq, "utf8");
    if (rel !== HISTORICO) {
      for (const c of chamadas(arq, "lead")) {
        if (!/\bkanbanColumn(Id)?\b/.test(c.dados)) continue;
        if (c.metodo === "create" && fonte.includes("registrarCriacaoLead")) continue;
        violacoes.push(`${rel}:${c.linha} lead.${c.metodo}() grava a coluna direto — use aplicarMudancaDeEtapa`);
      }
    }
    if (rel.startsWith(path.join("src", "lib", "comercial")) || rel.startsWith(path.join("src", "app", "api", "comercial")) || rel.startsWith(path.join("src", "app", "comercial"))) {
      if (rel !== MOVER && /\baplicarMudancaDeEtapa(EmLote)?\b|\bmoverLeadPorTipo\b|\bfundirColuna\b/.test(fonte)) violacoes.push(`${rel}: mexe na coluna do Lead fora do mover do Comercial`);
      if (/\b(insert\s+into|update)\s+(public\.)?("Lead"|com_oportunidade)\b/i.test(fonte)) violacoes.push(`${rel}: SQL cru gravando Lead/oportunidade`);
    }
  }
  assert.deepEqual(violacoes, []);
  assert.match(fs.readFileSync(path.join(process.cwd(), MOVER), "utf8"), /aplicarMudancaDeEtapa\(/, "o mover sincroniza o Lead pelo caminho único");
});
