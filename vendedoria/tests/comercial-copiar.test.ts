// scripts/comercial-copiar.mjs contra um banco descartável: migrações do Vendedor IA + schema `crm` criado do
// schema Prisma do CRM + semente parecida com produção. Copia 2× (a 2ª insere 0), verifica (verde),
// estraga uma linha (vermelho), copia de novo (repara), refaz e desfaz. Pulado sem DATABASE_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { criarSchemaCrm, semearCrm } from "./_comercial-semente";

const temBanco = Boolean(process.env.DATABASE_URL);
const RAIZ = process.cwd();

function rodar(url: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "comercial-copiar.mjs"), ...args], {
    encoding: "utf8", cwd: RAIZ, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}
const inseridas = (saida: string) => Number(/TOTAL inseridas=(\d+)/.exec(saida)?.[1] ?? NaN);

test("cópia CRM → Comercial: 2× sem duplicar, verificação verde, reparo, refazer e desfazer", { skip: !temBanco, timeout: 240_000 }, async () => {
  const base = new URL(process.env.DATABASE_URL!);
  const nomeBanco = `copia_comercial_${Date.now().toString(36)}`;
  const url = new URL(base.toString());
  url.pathname = `/${nomeBanco}`;
  url.searchParams.delete("schema");
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  await admin.$executeRawUnsafe(`create database "${nomeBanco}"`);
  let db: PrismaClient | null = null;
  try {
    const dep = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "db-deploy.mjs")], { encoding: "utf8", cwd: RAIZ, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() } });
    assert.equal(dep.status, 0, dep.stderr);
    criarSchemaCrm(url.toString());
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    // Um usuário do CRM já existe no Vendedor IA (e-mail em outra caixa) e dois motivos já existem com outro id.
    await db.user.create({ data: { email: "pedro@avanteza.test", name: "Pedro", role: "ADMIN" } });
    const semente = await semearCrm(db, { quantidade: 30, emailsExistentes: ["pedro@avanteza.test"] });
    await db.motivoEncerramento.createMany({ data: [{ organizationId: semente.orgId, tipo: "PERDA", nome: "Preço" }, { organizationId: semente.orgId, tipo: "GANHO", nome: "Atendimento rápido" }] });

    const rel = rodar(url.toString(), "--relatorio");
    assert.equal(rel.codigo, 0, rel.saida);
    assert.match(rel.saida, /Oportunidade\s+30\s+0\s+0\s+30/);
    assert.match(rel.saida, /a criar sem senha, só SSO: 2/);

    const antes = rodar(url.toString(), "--verificar");
    assert.notEqual(antes.codigo, 0, "verificar antes de copiar é vermelho");

    const c1 = rodar(url.toString(), "--copiar");
    assert.equal(c1.codigo, 0, c1.saida);
    assert.ok(inseridas(c1.saida) > 100, c1.saida);
    assert.match(c1.saida, /Mensagem\s+inseridas=2\b/, "mensagem da extensão fica de fora");
    const c2 = rodar(url.toString(), "--copiar");
    assert.equal(c2.codigo, 0, c2.saida);
    assert.equal(inseridas(c2.saida), 0, `2ª execução insere 0:\n${c2.saida}`);

    const v = rodar(url.toString(), "--verificar");
    assert.equal(v.codigo, 0, v.saida);
    assert.match(v.saida, /VERDE/);

    // Conversões: usuário mapeado por e-mail, criado sem senha, motivo remapeado, Lead ausente vira nulo, etapa com coluna.
    const pedro = await db.user.findFirstOrThrow({ where: { email: "pedro@avanteza.test" } });
    assert.ok(await db.comOportunidade.count({ where: { responsavelId: pedro.id } }) > 0, "responsável casado por e-mail");
    const nova = await db.user.findFirstOrThrow({ where: { email: semente.usuarioNovoEmail } });
    assert.equal(nova.password, null);
    assert.equal(nova.role, "SELLER");
    const preco = await db.motivoEncerramento.findFirstOrThrow({ where: { organizationId: semente.orgId, tipo: "PERDA", nome: "Preço" } });
    const crmPreco = await db.$queryRawUnsafe<Array<{ id: string }>>(`select id from crm."MotivoEncerramento" where nome='Preço'`);
    assert.notEqual(preco.id, crmPreco[0].id, "motivo que já existia mantém o id do Vendedor IA");
    assert.equal(await db.comOportunidade.count({ where: { leadId: null } }), 1, "lead inexistente vira leadId nulo");
    assert.equal(await db.comContato.count({ where: { leadId: { not: null } } }), 29);
    assert.deepEqual((await db.comEtapa.findMany({ orderBy: { ordem: "asc" } })).map((e) => e.kanbanColumnType), ["TRIAGE", "EM_QUALIFICACAO", "PROPOSTA_NEGOCIACAO", "CONTRATO", "GANHO", "LOST"]);
    const ev = await db.calendarEvent.findFirstOrThrow({ where: { oportunidadeId: { not: null } }, include: { attendees: true } });
    assert.equal(ev.attendees.length, 2);
    assert.equal(ev.status, "SCHEDULED");
    assert.equal(await db.comConfiguracao.count(), 0, "Configuracao (segredos) não é copiada");
    // A sequência continua depois do maior número copiado.
    const nOp = await db.comOportunidade.create({ data: { nome: "nova", contatoId: (await db.comContato.findFirstOrThrow()).id, funilId: (await db.comFunil.findFirstOrThrow()).id, etapaId: (await db.comEtapa.findFirstOrThrow()).id } });
    assert.equal(nOp.numero, 31);
    await db.comOportunidade.delete({ where: { id: nOp.id } });

    // Estraga: some um feedback copiado → vermelho; copiar repara.
    const fb = await db.comFeedback.findFirstOrThrow();
    await db.comFeedback.delete({ where: { id: fb.id } });
    const v2 = rodar(url.toString(), "--verificar");
    assert.notEqual(v2.codigo, 0, "divergência sai com código ≠ 0");
    assert.match(v2.saida, /VERMELHO/);
    const c3 = rodar(url.toString(), "--copiar");
    assert.equal(inseridas(c3.saida), 1, c3.saida);
    assert.equal(rodar(url.toString(), "--verificar").codigo, 0);

    // Linha criada só no destino: vermelho por padrão, aviso com --permitir-extras; refazer limpa.
    const extra = await db.comContato.create({ data: { tipo: "PESSOA", nome: "Criado na homologação" } });
    assert.notEqual(rodar(url.toString(), "--verificar").codigo, 0);
    assert.equal(rodar(url.toString(), "--verificar", "--permitir-extras").codigo, 0);
    assert.notEqual(rodar(url.toString(), "--refazer").codigo, 0, "refazer sem --sim não roda");
    const rf = rodar(url.toString(), "--refazer", "--sim");
    assert.equal(rf.codigo, 0, rf.saida);
    assert.equal(await db.comContato.count({ where: { id: extra.id } }), 0);
    assert.equal(rodar(url.toString(), "--verificar").codigo, 0);

    // Desfazer apaga o que veio do CRM.
    const d = rodar(url.toString(), "--desfazer", "--sim");
    assert.equal(d.codigo, 0, d.saida);
    assert.equal(await db.comOportunidade.count(), 0);
    assert.equal(await db.comContato.count(), 0);
    assert.equal(await db.calendarEvent.count({ where: { oportunidadeId: { not: null } } }), 0);
    assert.equal(await db.user.count({ where: { email: semente.usuarioNovoEmail } }), 0, "usuário criado pela cópia e sem uso sai");
    assert.equal(await db.user.count({ where: { email: "pedro@avanteza.test" } }), 1, "usuário que já existia fica");
  } finally {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`drop database if exists "${nomeBanco}" with (force)`);
    await admin.$disconnect();
  }
});
