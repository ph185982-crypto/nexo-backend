// Meta de poupança com cobrança diária: o Max cobra o valor do dia, registra "guardei 63"
// como aporte (não despesa) e mostra a projeção até o prazo.
import test from "node:test";
import assert from "node:assert/strict";
import { projetarMeta } from "@/lib/finance/metas-poupanca";
import { crc16, pixCopiaECola } from "@/lib/finance/pix";

const temBanco = Boolean(process.env.DATABASE_URL);
const D = (s: string) => new Date(`${s}T00:00:00Z`);

test("projeção: R$ 63/dia de 16/11/2026 a 31/05/2027 não fecha R$ 28 mil — mostra o necessário", () => {
  const p = projetarMeta({
    alvo: 28000, atual: 1000, aporteDiario: 63,
    dataInicio: D("2026-11-16"), dataFim: D("2027-05-31"), hoje: D("2026-11-16"),
    guardadoHoje: 0, guardadoAteOntem: 0,
  });
  assert.equal(p.diasRestantes, 197);
  assert.equal(p.pendenteHoje, 63);
  assert.equal(p.falta, 27000);
  assert.equal(p.projetadoNoPrazo, 1000 + 63 * 197); // 13.411
  assert.equal(p.necessarioPorDia, 138); // 27.000 / 197 = 137,06 → 138
  assert.equal(p.vaiBater, false);
  assert.equal(p.atraso, 0);
});

test("Pix copia e cola: CRC do exemplo do Banco Central e payload com chave e valor", () => {
  // Exemplo do Manual do BR Code (BCB): CRC final 1D3D
  const exemplo = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(crc16(exemplo), "1D3D");
  const chave = "d57d1fc1-c6cc-4ce9-bf6c-6bdce974b687";
  const cod = pixCopiaECola({ chave, valor: 63 });
  assert.ok(cod.startsWith("000201"));
  assert.ok(cod.includes(`0136${chave}`));
  assert.ok(cod.includes("540563.00"));
  assert.ok(cod.includes("5802BR"));
  assert.equal(cod.slice(-4), crc16(cod.slice(0, -4)));
  assert.ok(!pixCopiaECola({ chave }).includes("5405"), "sem valor, sem campo 54");
});

test("projeção: dia cumprido sai da conta, atraso acumula, meta batida", () => {
  const base = { alvo: 1000, aporteDiario: 10, dataInicio: D("2026-11-01"), dataFim: D("2026-11-30"), hoje: D("2026-11-11") };
  const cumprido = projetarMeta({ ...base, atual: 110, guardadoHoje: 10, guardadoAteOntem: 100 });
  assert.equal(cumprido.pendenteHoje, 0);
  assert.equal(cumprido.diasRestantes, 19); // 12..30
  assert.equal(cumprido.atraso, 0);
  const atrasado = projetarMeta({ ...base, atual: 40, guardadoHoje: 0, guardadoAteOntem: 40 });
  assert.equal(atrasado.atraso, 60); // 10 dias × 10 − 40
  assert.equal(atrasado.diasRestantes, 20);
  assert.equal(atrasado.projetadoNoPrazo, 40 + 10 * 20);
  const batida = projetarMeta({ ...base, atual: 1000, guardadoHoje: 0, guardadoAteOntem: 990 });
  assert.equal(batida.concluida, true);
  assert.equal(batida.necessarioPorDia, 0);
});

test("seed, cobrança diária (manhã/noite, uma vez), aporte pelo Max e retirada", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { semearMetaPoupancaInicial, aplicarPixMetaInicial, META_INICIAL } = await import("@/lib/finance/metas-poupanca-iniciais");
  const { cobrarPoupancaDoDia } = await import("@/lib/max/crons/cobranca-poupanca");
  const { gerenciarMetaPoupanca } = await import("@/lib/max/tools/poupanca");
  const { listarMetasPoupanca } = await import("@/lib/finance/metas-poupanca");

  // Isola: outras metas de poupança do banco de teste ficam fora.
  await prisma.metaFinanceiraMax.updateMany({ where: { tipo: "poupanca" }, data: { status: "encerrada" } });
  await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { in: ["seed-meta-poupanca-28k-v1", "seed-meta-poupanca-pix-v1"] } } });
  await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { startsWith: "poupanca-" } } });

  const r1 = await semearMetaPoupancaInicial();
  assert.equal(r1.criada, true);
  assert.equal((await semearMetaPoupancaInicial()).criada, false, "entra uma vez só");

  let [meta] = await listarMetasPoupanca({ agora: new Date("2026-11-16T12:00:00Z") });
  assert.equal(meta.descricao, META_INICIAL.descricao);
  assert.equal(meta.alvo, 28000);
  assert.equal(meta.atual, 1000);
  assert.equal(meta.aporteDiario, 63);
  assert.equal(meta.cobrarDiariamente, true);
  assert.equal(meta.projecao.pendenteHoje, 63);

  assert.equal(meta.chavePix, META_INICIAL.chave_pix);
  // Meta antiga sem chave (como em produção): a chave entra uma vez; a do dono não é trocada.
  await prisma.metaFinanceiraMax.update({ where: { id: meta.id }, data: { chave_pix: null } });
  assert.equal((await aplicarPixMetaInicial()).aplicada, true);
  assert.equal((await prisma.metaFinanceiraMax.findUniqueOrThrow({ where: { id: meta.id } })).chave_pix, META_INICIAL.chave_pix);
  assert.equal((await aplicarPixMetaInicial()).aplicada, false);

  const msgs: string[] = [];
  const extras: string[][] = [];
  const entregar = async (a: { mensagem: string; complementos?: string[] }) => { msgs.push(a.mensagem); extras.push(a.complementos ?? []); return { whatsapp: true, notificacao: true }; };

  // 07:00 em Brasília: cedo demais
  assert.equal((await cobrarPoupancaDoDia({ agora: new Date("2026-11-16T10:00:00Z"), entregar })).situacao, "fora-do-horario");
  // 09:00: cobra, com o valor e a projeção
  const manha = await cobrarPoupancaDoDia({ agora: new Date("2026-11-16T12:00:00Z"), entregar });
  assert.equal(manha.situacao, "cobrado");
  assert.match(msgs[0], /Hora de guardar: R\$\s?63,00/);
  assert.match(msgs[0], /R\$\s?1\.000,00 de R\$\s?28\.000,00/);
  assert.match(msgs[0], /R\$\s?138,00\/dia/);
  assert.match(msgs[0], /guardei 63/);
  assert.match(msgs[0], /Pix para a reserva/);
  assert.ok(msgs[0].includes(META_INICIAL.chave_pix));
  assert.equal(extras[0][0], META_INICIAL.chave_pix, "chave sozinha numa mensagem");
  assert.ok(extras[0][1].startsWith("000201") && extras[0][1].includes("540563.00"), "copia e cola com R$ 63");
  // 11:00: já cobrou de manhã
  assert.equal((await cobrarPoupancaDoDia({ agora: new Date("2026-11-16T14:00:00Z"), entregar })).situacao, "nada");
  assert.equal(msgs.length, 1);

  // Sem canal: libera a trava e tenta de novo depois
  const semCanal = await cobrarPoupancaDoDia({ agora: new Date("2026-11-16T23:00:00Z"), entregar: async () => ({ whatsapp: false, notificacao: false }) });
  assert.equal(semCanal.situacao, "sem-canal");
  // 20:30: lembrete da noite
  const noite = await cobrarPoupancaDoDia({ agora: new Date("2026-11-16T23:30:00Z"), entregar });
  assert.equal(noite.situacao, "cobrado");
  assert.match(msgs[1], /Ainda faltam R\$\s?63,00/);

  // "guardei 63" pelo Max: aporte, não despesa
  const despesasAntes = await prisma.transacao.count();
  const resp = await gerenciarMetaPoupanca({ acao: "aportar", valor: 63, data: "2026-11-17" });
  assert.match(resp, /Registrei R\$\s?63,00 guardados/);
  assert.equal(await prisma.transacao.count(), despesasAntes, "aporte não vira transação");

  // Dia 17 cumprido: não cobra
  [meta] = await listarMetasPoupanca({ agora: new Date("2026-11-17T12:00:00Z") });
  assert.equal(meta.atual, 1063);
  assert.equal(meta.projecao.pendenteHoje, 0);
  assert.equal(meta.projecao.atraso, 63, "dia 16 ficou sem aporte");
  assert.equal((await cobrarPoupancaDoDia({ agora: new Date("2026-11-17T12:00:00Z"), entregar })).situacao, "nada");

  // Retirada e ajuste do valor diário
  await gerenciarMetaPoupanca({ acao: "retirar", valor: 50, data: "2026-11-17" });
  const ajuste = await gerenciarMetaPoupanca({ acao: "ajustar", aporte_diario: 138 });
  assert.match(ajuste, /Meta ajustada/);
  const final = await prisma.metaFinanceiraMax.findUniqueOrThrow({ where: { id: meta.id } });
  assert.equal(final.valor_atual, 1013);
  assert.equal(final.aporte_diario, 138);

  // Livro-razão: aportes ficam no histórico financeiro
  const hist = await prisma.historicoFinanceiro.count({ where: { entidade: "AporteMetaMax" } });
  assert.ok(hist >= 3);
});
