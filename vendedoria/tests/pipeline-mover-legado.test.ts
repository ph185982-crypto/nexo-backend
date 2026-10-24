// Reproduz o layout de colunas que está em produção (colunas CUSTOM) e confere
// que a movimentação acha as colunas — e que o evento da Meta sai na coluna certa.
import test from "node:test";
import assert from "node:assert/strict";

const temBanco = Boolean(process.env.DATABASE_URL);

test("layout legado: leads chegam em Em qualificação / Qualificados / Ganho e geram eventos", { skip: !temBanco }, async () => {
  process.env.META_CAPI_DRY_RUN = "true";
  process.env.META_WABA_ID = "3170296709806629";
  const { prisma } = await import("@/lib/prisma/client");
  const { moverLeadPorTipo } = await import("@/lib/crm/pipeline-mover");
  const marca = `p${Date.now()}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const defs: Array<[string, string]> = [
    ["Novos", "TRIAGE"], ["Em qualificação", "CUSTOM"], ["Qualificados", "CUSTOM"], ["Mornos", "CUSTOM"],
    ["Handoff enviado", "ESCALATED"], ["Fora do ICP", "LOST"], ["1º Contato", "CONTATO_1"], ["Proposta", "PROPOSTA"],
    ["Em Contrato", "CONTRATO"], ["Ganho", "GANHO"],
  ];
  for (const [i, [name, type]] of defs.entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: type === "TRIAGE" } });
  }
  const novos = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const mk = (origin: string, clid: string | null) =>
    prisma.lead.create({ data: { phoneNumber: `55${Math.floor(Math.random() * 1e9)}`, leadOrigin: origin, organizationId: org.id, kanbanColumnId: novos.id, ctwaClid: clid } });
  const colunaDe = async (id: string) => (await prisma.lead.findUnique({ where: { id }, include: { kanbanColumn: true } }))!.kanbanColumn.name;
  const eventos = (id: string) => prisma.metaConversionEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: "asc" } });

  try {
    const anuncio = await mk("INBOUND", "CLID_" + marca);
    assert.equal(await moverLeadPorTipo(anuncio.id, org.id, "EM_QUALIFICACAO"), true);
    assert.equal(await colunaDe(anuncio.id), "Em qualificação");
    assert.equal((await eventos(anuncio.id)).length, 0);

    assert.equal(await moverLeadPorTipo(anuncio.id, org.id, "QUALIFICADO", "teste"), true);
    assert.equal(await colunaDe(anuncio.id), "Qualificados");
    let ev = await eventos(anuncio.id);
    assert.deepEqual(ev.map((e) => [e.eventName, e.status]), [["LeadSubmitted", "DRY_RUN"]]);

    // idempotente: mesma coluna não move nem duplica
    assert.equal(await moverLeadPorTipo(anuncio.id, org.id, "QUALIFICADO"), false);
    // passar por outras colunas e voltar não duplica o evento
    await moverLeadPorTipo(anuncio.id, org.id, "PROPOSTA"); // outras colunas não geram evento
    await moverLeadPorTipo(anuncio.id, org.id, "CONTRATO");
    assert.equal((await eventos(anuncio.id)).length, 1);
    await moverLeadPorTipo(anuncio.id, org.id, "QUALIFICADO");
    assert.equal((await eventos(anuncio.id)).length, 1);

    assert.equal(await moverLeadPorTipo(anuncio.id, org.id, "GANHO"), true);
    assert.equal(await colunaDe(anuncio.id), "Ganho");
    ev = await eventos(anuncio.id);
    assert.deepEqual(ev.map((e) => e.eventName).sort(), ["LeadSubmitted", "Purchase"]);

    // lead OUTBOUND ou sem clid: move, mas nunca gera evento
    const outbound = await mk("OUTBOUND", "CLID_X");
    const semClid = await mk("INBOUND", null);
    for (const l of [outbound, semClid]) {
      await moverLeadPorTipo(l.id, org.id, "QUALIFICADO");
      await moverLeadPorTipo(l.id, org.id, "GANHO");
      assert.equal((await eventos(l.id)).length, 0);
      assert.equal(await colunaDe(l.id), "Ganho");
    }

    // demais destinos do layout legado
    const x = await mk("INBOUND", null);
    await moverLeadPorTipo(x.id, org.id, "ESCALATED", "handoff", "QUALIFICADO");
    assert.equal(await colunaDe(x.id), "Handoff enviado");
    await moverLeadPorTipo(x.id, org.id, "MORNO");
    assert.equal(await colunaDe(x.id), "Mornos");
    await moverLeadPorTipo(x.id, org.id, "LOST");
    assert.equal(await colunaDe(x.id), "Fora do ICP");
    await moverLeadPorTipo(x.id, org.id, "CONTATO_1"); // comportamento original: canônico TRIAGE
    assert.equal(await colunaDe(x.id), "Novos");
  } finally {
    const leads = await prisma.lead.findMany({ where: { organizationId: org.id }, select: { id: true } });
    const ids = leads.map((l) => l.id);
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.clientDiagnosis.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});

test("layout canônico continua igual: PROPOSTA_NEGOCIACAO recebe QUALIFICADO", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { moverLeadPorTipo, consolidarColunasEm5Etapas } = await import("@/lib/crm/pipeline-mover");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `c${Date.now()}`, documentId: "1", documentType: "CNPJ" } });
  try {
    await consolidarColunasEm5Etapas(org.id);
    const novos = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
    const lead = await prisma.lead.create({ data: { phoneNumber: "5562988887777", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: novos.id } });
    await moverLeadPorTipo(lead.id, org.id, "QUALIFICADO");
    const col = (await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } }))!.kanbanColumn;
    assert.equal(col.type, "PROPOSTA_NEGOCIACAO");
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  } finally {
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
