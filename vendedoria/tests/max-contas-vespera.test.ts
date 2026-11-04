// Aviso de véspera das contas a pagar: um dia antes do vencimento o Max avisa o dono.
import test from "node:test";
import assert from "node:assert/strict";
import { amanhaComoData, montarMensagemVespera, partesBrasilia, chaveVespera } from "@/lib/max/crons/contas-vespera";

const temBanco = Boolean(process.env.DATABASE_URL);

test("partesBrasilia: dia e hora em Brasília, não em UTC", () => {
  assert.deepEqual(partesBrasilia(new Date("2026-11-04T12:00:00Z")), { dia: "2026-11-04", hora: 9 });
  // 01:30 UTC de 05/11 ainda é 22:30 de 04/11 em Brasília
  assert.deepEqual(partesBrasilia(new Date("2026-11-05T01:30:00Z")), { dia: "2026-11-04", hora: 22 });
});

test("amanhaComoData: vira o mês e o ano", () => {
  assert.equal(amanhaComoData("2026-11-04").toISOString().slice(0, 10), "2026-11-05");
  assert.equal(amanhaComoData("2026-10-31").toISOString().slice(0, 10), "2026-11-01");
  assert.equal(amanhaComoData("2026-12-31").toISOString().slice(0, 10), "2027-01-01");
});

test("mensagem: uma conta e várias, com total", () => {
  const amanha = amanhaComoData("2026-11-04");
  const uma = montarMensagemVespera([{ descricao: "Energia", valor: 366, categoria: "Casa" }], amanha);
  assert.match(uma, /vence uma conta/);
  assert.match(uma, /Energia — R\$\s?366,00 \(Casa\)/);
  assert.match(uma, /quinta-feira, 05\/11/);
  const varias = montarMensagemVespera([
    { descricao: "Água", valor: 200, categoria: "Casa" }, { descricao: "Internet", valor: 79.99, categoria: "Casa" },
  ], amanha);
  assert.match(varias, /vencem 2 contas/);
  assert.match(varias, /Total: R\$\s?279,99/);
});

test("avisarContasDeAmanha: horário, só amanhã, uma vez por vencimento, e nova tentativa sem canal", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { avisarContasDeAmanha } = await import("@/lib/max/crons/contas-vespera");
  const D = (s: string) => new Date(`${s}T00:00:00Z`);
  const tag = `vespera-${Date.now()}`;
  const mk = (descricao: string, venc: string, status = "pendente") =>
    prisma.contaPagarMax.create({ data: { descricao: `${tag} ${descricao}`, valor: 100, data_vencimento: D(venc), categoria: "Casa", tipo_negocio: "pessoal", status } });

  const AGORA = new Date("2026-11-04T12:00:00Z"); // 09:00 em Brasília, dia 04/11
  const amanha = await mk("amanha", "2026-11-05");
  await mk("hoje", "2026-11-04");
  await mk("depois", "2026-11-06");
  await mk("paga", "2026-11-05", "paga");

  const entregas: string[][] = [];
  const entregar = async (_m: string, itens: Array<{ descricao: string }>) => { entregas.push(itens.map((i) => i.descricao)); return { whatsapp: true, notificacao: true }; };
  const minhas = (xs: string[]) => xs.filter((d) => d.startsWith(tag));

  try {
    // Fora do horário (03:00 em Brasília): nada
    const cedo = await avisarContasDeAmanha({ agora: new Date("2026-11-04T06:00:00Z"), entregar });
    assert.equal(cedo.situacao, "fora-do-horario");
    assert.equal(entregas.length, 0);

    // No horário: só a conta pendente que vence amanhã
    const r1 = await avisarContasDeAmanha({ agora: AGORA, entregar });
    assert.equal(r1.situacao, "avisado");
    assert.deepEqual(minhas(entregas.flat()), [`${tag} amanha`]);

    // Segunda rodada no mesmo dia: não repete
    const antes = entregas.length;
    await avisarContasDeAmanha({ agora: new Date("2026-11-04T15:00:00Z"), entregar });
    assert.equal(minhas(entregas.slice(antes).flat()).length, 0, "não repete o aviso");

    // Mudou o vencimento para outro dia: aviso novo na véspera da nova data
    await prisma.contaPagarMax.update({ where: { id: amanha.id }, data: { data_vencimento: D("2026-11-10") } });
    const r2 = await avisarContasDeAmanha({ agora: new Date("2026-11-09T12:00:00Z"), entregar });
    assert.equal(r2.situacao, "avisado");
    assert.ok(minhas(entregas.flat()).filter((d) => d === `${tag} amanha`).length === 2, "novo vencimento, novo aviso");

    // Nenhum canal entregou: libera a trava e a próxima rodada tenta de novo
    await prisma.contaPagarMax.update({ where: { id: amanha.id }, data: { data_vencimento: D("2026-11-20") } });
    const semCanal = await avisarContasDeAmanha({ agora: new Date("2026-11-19T12:00:00Z"), entregar: async () => ({ whatsapp: false, notificacao: false }) });
    assert.equal(semCanal.situacao, "sem-canal");
    assert.equal(await prisma.alertaEnviadoMax.count({ where: { chave: chaveVespera(amanha.id, "2026-11-20") } }), 0, "trava liberada");
    const retry = await avisarContasDeAmanha({ agora: new Date("2026-11-19T13:00:00Z"), entregar });
    assert.equal(retry.situacao, "avisado");
  } finally {
    const ids = (await prisma.contaPagarMax.findMany({ where: { descricao: { startsWith: tag } }, select: { id: true } })).map((c) => c.id);
    await prisma.alertaEnviadoMax.deleteMany({ where: { OR: ids.map((id) => ({ chave: { startsWith: `conta-vespera-${id}-` } })) } });
    await prisma.contaPagarMax.deleteMany({ where: { descricao: { startsWith: tag } } });
  }
});
