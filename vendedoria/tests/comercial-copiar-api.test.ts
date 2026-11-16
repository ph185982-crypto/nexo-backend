// scripts/comercial-copiar.mjs pelo caminho da API de gestão do Supabase (--api-supabase), sem rede: um servidor
// falso no lugar de api.supabase.com executa cada query com o psql num banco descartável (leitura embrulhada em
// json_agg, escrita com ON_ERROR_STOP, como o Postgres faz com um query de várias instruções). Cobre: cópia 2×
// (2ª = 0), erro no meio da transação (rollback: nada gravado), verificar, refazer e desfazer, e o token fora da saída.
// Pulado sem DATABASE_URL ou sem psql.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { criarSchemaCrm, semearCrm } from "./_comercial-semente";

const temPsql = spawnSync("psql", ["--version"]).status === 0;
const pular = !process.env.DATABASE_URL || !temPsql;
const RAIZ = process.cwd();
const TOKEN = "token-falso-nao-imprimir-123";

interface Falsa { url: string; chamadas: Array<{ read_only: boolean; query: string }>; falharAntesDe: string | null; fechar: () => Promise<void> }

/** API falsa: confere o Bearer, roda o SQL no banco `dbUrl` e responde como a API de gestão (200 JSON / 400 { message }). */
async function apiFalsa(dbUrl: string): Promise<Falsa> {
  const estado = { chamadas: [] as Falsa["chamadas"], falharAntesDe: null as string | null };
  const psql = (args: string[], entrada: string) => new Promise<{ codigo: number; saida: string; erro: string }>((ok) => {
    const p = spawn("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args]);
    let saida = "", erro = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (erro += d));
    p.on("close", (codigo) => ok({ codigo: codigo ?? 1, saida, erro }));
    p.stdin.end(entrada);
  });
  const servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", async () => {
      const responder = (status: number, dados: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(dados)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}` || !/^\/v1\/projects\/ref-teste\/database\/query$/.test(req.url ?? "")) return responder(401, { message: "não autorizado" });
      const { query, read_only } = JSON.parse(corpo) as { query: string; read_only: boolean };
      estado.chamadas.push({ query, read_only });
      if (read_only) {
        const r = await psql(["-At", "-f", "-"], `select coalesce(json_agg(t), '[]'::json) from (${query}) t`);
        return r.codigo === 0 ? responder(201, JSON.parse(r.saida.trim())) : responder(400, { message: `Failed to run sql query: ${r.erro}` });
      }
      let sql = query;
      if (estado.falharAntesDe && sql.includes(estado.falharAntesDe)) sql = sql.replace(estado.falharAntesDe, `select 1/0;\n${estado.falharAntesDe}`);
      const r = await psql(["-f", "-"], sql);
      return r.codigo === 0 ? responder(201, []) : responder(400, { message: `Failed to run sql query: ${r.erro}` });
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as AddressInfo).port;
  return Object.assign(estado, { url: `http://127.0.0.1:${porta}`, fechar: () => new Promise<void>((ok) => servidor.close(() => ok())) }) as Falsa;
}

function rodar(api: string, ...args: string[]) {
  return new Promise<{ codigo: number; saida: string }>((ok) => {
    const env: NodeJS.ProcessEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_API_BASE: api };
    delete env.DATABASE_URL; delete env.DIRECT_URL; // no modo API o script não abre conexão própria
    const p = spawn(process.execPath, [path.join(RAIZ, "scripts", "comercial-copiar.mjs"), ...args, "--api-supabase", "ref-teste"], { cwd: RAIZ, env });
    let saida = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (saida += d));
    p.on("close", (codigo) => ok({ codigo: codigo ?? 1, saida }));
  });
}
const inseridas = (saida: string) => Number(/TOTAL inseridas=(-?\d+)/.exec(saida)?.[1] ?? NaN);

test("cópia pela API de gestão: transação única, 2ª = 0, rollback em erro, verificar/refazer/desfazer", { skip: pular, timeout: 300_000 }, async () => {
  const base = new URL(process.env.DATABASE_URL!);
  const nomeBanco = `copia_api_${Date.now().toString(36)}`;
  const url = new URL(base.toString());
  url.pathname = `/${nomeBanco}`;
  url.search = "";
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  await admin.$executeRawUnsafe(`create database "${nomeBanco}"`);
  let db: PrismaClient | null = null;
  let api: Falsa | null = null;
  try {
    const dep = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "db-deploy.mjs")], { encoding: "utf8", cwd: RAIZ, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() } });
    assert.equal(dep.status, 0, dep.stderr);
    criarSchemaCrm(url.toString());
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await semearCrm(db, { quantidade: 20 });
    api = await apiFalsa(url.toString());
    const usuariosAntes = await db.user.count();

    // Erro no meio (depois de funil, etapas e contatos, antes das oportunidades): nada fica gravado.
    api.falharAntesDe = "insert into public.com_oportunidade(";
    const falha = await rodar(api.url, "--copiar");
    assert.notEqual(falha.codigo, 0, falha.saida);
    assert.match(falha.saida, /API Supabase 400/);
    assert.equal(await db.comFunil.count(), 0, "rollback: funil inserido antes do erro não ficou");
    assert.equal(await db.comContato.count(), 0, "rollback: contatos não ficaram");
    assert.equal(await db.user.count(), usuariosAntes, "rollback: usuários não ficaram");
    const escrita = api.chamadas.filter((c) => !c.read_only);
    assert.equal(escrita.length, 1, "uma escrita só, com todas as instruções");
    assert.match(escrita[0].query, /^begin;\n[\s\S]*\ncommit;$/);
    api.falharAntesDe = null;

    const c1 = await rodar(api.url, "--copiar");
    assert.equal(c1.codigo, 0, c1.saida);
    assert.ok(inseridas(c1.saida) > 100, c1.saida);
    assert.match(c1.saida, /Oportunidade\s+inseridas=20\b/);
    assert.match(c1.saida, /Mensagem\s+inseridas=2\b/, "mensagem da extensão fica de fora");
    const c2 = await rodar(api.url, "--copiar");
    assert.equal(c2.codigo, 0, c2.saida);
    assert.equal(inseridas(c2.saida), 0, `2ª execução insere 0:\n${c2.saida}`);

    const v = await rodar(api.url, "--verificar");
    assert.equal(v.codigo, 0, v.saida);
    assert.match(v.saida, /VERDE/);
    await db.comFeedback.delete({ where: { id: (await db.comFeedback.findFirstOrThrow()).id } });
    assert.notEqual((await rodar(api.url, "--verificar")).codigo, 0, "divergência sai com código ≠ 0");

    assert.notEqual((await rodar(api.url, "--refazer")).codigo, 0, "refazer sem --sim não roda");
    const rf = await rodar(api.url, "--refazer", "--sim");
    assert.equal(rf.codigo, 0, rf.saida);
    assert.match(rf.saida, /Oportunidade\s+apagadas=20\b/);
    assert.equal((await rodar(api.url, "--verificar")).codigo, 0, "refeito: verde de novo");

    const d = await rodar(api.url, "--desfazer", "--sim");
    assert.equal(d.codigo, 0, d.saida);
    assert.match(d.saida, /Oportunidade\s+apagadas=20\b/);
    assert.equal(await db.comOportunidade.count(), 0);
    assert.equal(await db.comContato.count(), 0);

    for (const s of [falha.saida, c1.saida, c2.saida, v.saida, rf.saida, d.saida]) assert.ok(!s.includes(TOKEN), "o token nunca aparece na saída");
  } finally {
    await api?.fechar();
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`drop database if exists "${nomeBanco}" with (force)`);
    await admin.$disconnect();
  }
});
