// Integração com banco: falha de conta da Meta pausa o disparo e devolve o lead;
// recuperação dos leads que nunca receberam; espelho da qualificação no Lead.
import test from "node:test";
import assert from "node:assert/strict";
import { camposCrmDaSessao } from "@/lib/ai/sdr/sincronizar-crm";
import { SDR_EMPTY_SESSION } from "@/lib/ai/sdr/types";

test("camposCrmDaSessao: ICP, faturamento, loja e CNPJ viram colunas do CRM", () => {
  const q = camposCrmDaSessao({
    ...SDR_EMPTY_SESSION, nome: "Carla", empresa: "Bella Modas", segmento: "moda", faturamento_total: "60 mil por mês",
    loja_fisica: "sim", cnpj: "tem", problema_principal: "Shopee parada em 3 pedidos/semana", score: 85,
  });
  assert.deepEqual(
    [q.empresa, q.faturamentoMensal, q.lojaFisica, q.cnpjStatus, q.icpStatus, q.scoreSdr],
    ["Bella Modas", 60000, "SIM", "TEM", "QUALIFICADO", 85],
  );
  const fora = camposCrmDaSessao({ ...SDR_EMPTY_SESSION, faturamento_total: "5 mil", loja_fisica: "nao", cnpj: "não tem" });
  assert.equal(fora.icpStatus, "FORA");
  const pendente = camposCrmDaSessao({ ...SDR_EMPTY_SESSION, faturamento_total: "50 mil" });
  assert.equal(pendente.icpStatus, "PENDENTE");
  assert.equal("empresa" in pendente, false); // não apaga dado do CRM com vazio
});

const temBanco = Boolean(process.env.DATABASE_URL);

test("falha de conta (131042): pausa o disparo uma vez, devolve o lead; recuperação acha os nunca entregues", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { registrarEnvio, aplicarStatusEnvio, recuperarLeadsNaoEntregues } = await import("@/lib/prospeccao/entrega");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `d${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  await prisma.disparoConfig.create({ data: { organizationId: org.id } });
  const mk = (status: string, tentativas = 1) =>
    prisma.prospectLead.create({ data: { organizationId: org.id, nome: "Loja", telefone: "62999990000", status, tentativasDisparo: tentativas } as never });
  try {
    const a = await mk("ABORDADO", 1);
    const w1 = `wamid.A${Date.now()}`;
    await registrarEnvio({ organizationId: org.id, leadId: a.id, wamid: w1, tentativa: 1 });
    await aplicarStatusEnvio({ id: w1, status: "failed", errors: [{ code: 131042, title: "Business eligibility payment issue" }] });

    const cfg = await prisma.disparoConfig.findUnique({ where: { organizationId: org.id } });
    assert.equal(cfg?.pausadoManualmente, true);
    assert.match(cfg?.motivoPausa ?? "", /131042/);
    const la = await prisma.prospectLead.findUnique({ where: { id: a.id } });
    assert.deepEqual([la?.status, la?.tentativasDisparo, la?.dataAbordagem], ["APROVADO", 0, null]);

    // segunda falha de conta não gera outro aviso
    const b = await mk("ABORDADO", 2);
    const w2 = `wamid.B${Date.now()}`;
    await registrarEnvio({ organizationId: org.id, leadId: b.id, wamid: w2, tentativa: 2 });
    await aplicarStatusEnvio({ id: w2, status: "failed", errors: [{ code: 131042 }] });
    assert.equal(await prisma.ownerNotification.count({ where: { organizationId: org.id } }), 1);
    assert.equal((await prisma.prospectLead.findUnique({ where: { id: b.id } }))?.tentativasDisparo, 1);

    // Recuperação: lead ABORDADO com envios só falhos por conta → volta; com um entregue → fica
    const c = await mk("ABORDADO", 2);
    const d = await mk("ABORDADO", 1);
    await prisma.disparoEnvio.createMany({ data: [
      { organizationId: org.id, leadId: c.id, status: "FAILED", erroCodigo: 131042 },
      { organizationId: org.id, leadId: c.id, status: "FAILED", erroCodigo: 131042 },
      { organizationId: org.id, leadId: d.id, status: "FAILED", erroCodigo: 131042 },
      { organizationId: org.id, leadId: d.id, status: "DELIVERED" },
    ] });
    const previa = await recuperarLeadsNaoEntregues(org.id, false);
    assert.equal(previa.encontrados, 1);
    assert.equal((await prisma.prospectLead.findUnique({ where: { id: c.id } }))?.status, "ABORDADO"); // prévia não altera
    const feito = await recuperarLeadsNaoEntregues(org.id, true);
    assert.equal(feito.recuperados, 1);
    assert.equal((await prisma.prospectLead.findUnique({ where: { id: c.id } }))?.status, "APROVADO");
    assert.equal((await prisma.prospectLead.findUnique({ where: { id: d.id } }))?.status, "ABORDADO");
  } finally {
    await prisma.disparoEnvio.deleteMany({ where: { organizationId: org.id } });
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.prospectLead.deleteMany({ where: { organizationId: org.id } });
    await prisma.disparoConfig.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});

test("sincronizarQualificacaoNoLead grava no Lead e troca apelido por nome real", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { sincronizarQualificacaoNoLead } = await import("@/lib/ai/sdr/sincronizar-crm");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `s${Date.now()}`, documentId: "1", documentType: "CNPJ" } });
  const col = await prisma.kanbanColumn.create({ data: { name: "Novos", order: 0, type: "TRIAGE", color: "#000", organizationId: org.id } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562911112222", profileName: "💨", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  try {
    await sincronizarQualificacaoNoLead(lead.id, {
      ...SDR_EMPTY_SESSION, nome: "Rafael Lima", empresa: "RL Autopeças", faturamento_total: "80 mil", loja_fisica: "sim", cnpj: "tem", score: 90,
    });
    const l = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.deepEqual([l?.profileName, l?.empresa, l?.faturamentoMensal, l?.icpStatus], ["Rafael Lima", "RL Autopeças", 80000, "QUALIFICADO"]);
  } finally {
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
