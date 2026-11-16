// Mover a oportunidade leva o Lead junto (mesma transação, caminho único do Lead) e preserva o gatilho da API de
// Conversões da Meta sem duplicar MetaConversionEvent. Pulado sem DATABASE_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { cenario, garantirOrganizacao } from "./_comercial-cenario";

const temBanco = Boolean(process.env.DATABASE_URL);

test("mover oportunidade sincroniza Lead, histórico do Lead e CAPI (sem duplicar)", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { criarOportunidade, moverOportunidade } = await import("@/lib/comercial/funil/mover");
  const { motivoIdPorNome } = await import("@/lib/comercial/funil/motivos");
  const c = await cenario();
  // Organização própria do lead, com o layout canônico de colunas.
  const marca = c.marca;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `Org ${marca}`, documentId: "1", documentType: "CNPJ" } });
  const col = async (type: string, name: string, order: number) => prisma.kanbanColumn.create({ data: { type, name, order, color: "#0b1b33", organizationId: org.id } });
  const triagem = await col("TRIAGE", "Leads", 0);
  await col("EM_QUALIFICACAO", "Qualificação", 1);
  await col("PROPOSTA_NEGOCIACAO", "Proposta e Negociação", 2);
  await col("GANHO", "Ganho", 3);
  await col("LOST", "Perdido", 4);
  const lead = await prisma.lead.create({ data: { phoneNumber: `55${Date.now() % 1e11}`, leadOrigin: "INBOUND", ctwaClid: `CLID_${marca}`, organizationId: org.id, kanbanColumnId: triagem.id } });
  const outroLead = await prisma.lead.create({ data: { phoneNumber: `55${(Date.now() + 1) % 1e11}`, leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: triagem.id } });
  try {
    await garantirOrganizacao();
    const tipos: Array<[string, string]> = [[c.leads.id, "TRIAGE"], [c.qualif.id, "EM_QUALIFICACAO"], [c.proposta.id, "PROPOSTA_NEGOCIACAO"], [c.ganha.id, "GANHO"], [c.perdida.id, "LOST"]];
    for (const [id, t] of tipos) await prisma.comEtapa.update({ where: { id }, data: { kanbanColumnType: t } });

    const op = await criarOportunidade({ nome: "Com lead", contatoId: c.contato.id, funilId: c.funil.id, leadId: lead.id });
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))!.kanbanColumnId, triagem.id, "criar não move o Lead");

    const r1 = await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL", ator: "u1" });
    assert.equal(r1.lead?.coluna.type, "EM_QUALIFICACAO");
    const l1 = (await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } }))!;
    assert.equal(l1.kanbanColumn.type, "EM_QUALIFICACAO");
    const h = await prisma.leadStageHistory.findMany({ where: { leadId: lead.id }, orderBy: { enteredAt: "asc" } });
    assert.deepEqual(h.map((x) => [x.toType, x.origem]), [["TRIAGE", "BACKFILL"], ["EM_QUALIFICACAO", "COMERCIAL"]]);
    assert.equal(await prisma.metaConversionEvent.count({ where: { leadId: lead.id } }), 0, "qualificação não é evento da Meta");

    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.deepEqual((await prisma.metaConversionEvent.findMany({ where: { leadId: lead.id } })).map((e) => e.eventName), ["LeadSubmitted"]);

    const motivoId = await motivoIdPorNome("GANHO", "Atendimento rápido");
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL", motivoId });
    const l2 = (await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } }))!;
    assert.equal(l2.kanbanColumn.type, "GANHO");
    assert.ok(l2.encerradoEm, "Lead encerrado junto");
    // Mesmo catálogo de motivos: vale para o Lead se for da mesma organização (aqui o lead é de outra org: fica nulo).
    assert.equal(l2.motivoEncerramentoId, null);

    // Volta e ganha de novo: nenhum evento duplicado.
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.proposta.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const evs = await prisma.metaConversionEvent.groupBy({ by: ["eventName"], where: { leadId: lead.id }, _count: true });
    assert.deepEqual(evs.map((e) => [e.eventName, e._count]).sort(), [["LeadSubmitted", 1], ["Purchase", 1]]);

    // Etapa sem coluna equivalente ou oportunidade sem Lead: o Lead não muda.
    await prisma.comEtapa.update({ where: { id: c.perdida.id }, data: { kanbanColumnType: null } });
    const r2 = await moverOportunidade({ oportunidadeId: op.id, etapaId: c.perdida.id, origem: "MANUAL" });
    assert.equal(r2.lead, null);
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } }))!.kanbanColumn.type, "GANHO");
    const semLead = await criarOportunidade({ nome: "Sem lead", contatoId: c.contato.id, funilId: c.funil.id });
    assert.equal((await moverOportunidade({ oportunidadeId: semLead.id, etapaId: c.qualif.id, origem: "MANUAL" })).lead, null);
    assert.equal((await prisma.lead.findUnique({ where: { id: outroLead.id } }))!.kanbanColumnId, triagem.id);
  } finally {
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: { in: [lead.id, outroLead.id] } } });
    await c.limpar();
    await prisma.leadStageHistory.deleteMany({ where: { leadId: { in: [lead.id, outroLead.id] } } });
    await prisma.lead.deleteMany({ where: { id: { in: [lead.id, outroLead.id] } } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  }
});
