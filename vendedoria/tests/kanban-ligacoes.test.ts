// Itens 8 e 9 (30/10): correção dos cards presos em "Novos", lead de prospecção
// nascendo em "1º Contato", e a fila de ligações do Pedro.
import test from "node:test";
import assert from "node:assert/strict";

const temBanco = Boolean(process.env.DATABASE_URL);

async function fixture() {
  const { prisma } = await import("@/lib/prisma/client");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `k${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  const cols: Record<string, string> = {};
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["1º Contato", "CONTATO_1"], ["Handoff enviado", "ESCALATED"]] as const).entries()) {
    const c = await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
    cols[type] = c.id;
  }
  const mk = (phone: string, leadOrigin: string, status: string, extra: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { phoneNumber: phone, profileName: `L${phone.slice(-4)}`, leadOrigin, status, organizationId: org.id, kanbanColumnId: cols.TRIAGE, ...extra } });
  const limpar = async () => {
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.leadActivity.deleteMany({ where: { lead: { organizationId: org.id } } });
    await prisma.whatsappConversation.deleteMany({ where: { lead: { organizationId: org.id } } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.prospectLead.deleteMany({ where: { organizationId: org.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  };
  return { prisma, org, cols, mk, limpar };
}

test("sincronização do Kanban: escalados → Handoff, outbound → 1º Contato, idempotente, com registro", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma, org, cols, mk, limpar } = await fixture();
  const { previaSincronizacao, aplicarSincronizacao } = await import("@/lib/crm/sincronizar-kanban");
  const a = await mk("5562911110001", "OUTBOUND", "OPEN");
  const b = await mk("5562911110002", "INBOUND", "ESCALATED");
  const c = await mk("5562911110003", "INBOUND", "OPEN");
  try {
    assert.equal((await previaSincronizacao(org.id, "escalados")).quantidade, 1);
    assert.equal((await previaSincronizacao(org.id, "outbound")).quantidade, 1);
    assert.equal((await aplicarSincronizacao(org.id, "escalados")).movidos, 1);
    assert.equal((await aplicarSincronizacao(org.id, "outbound")).movidos, 1);
    assert.equal((await aplicarSincronizacao(org.id, "escalados")).movidos, 0, "idempotente");
    assert.equal((await prisma.lead.findUnique({ where: { id: a.id } }))?.kanbanColumnId, cols.CONTATO_1);
    assert.equal((await prisma.lead.findUnique({ where: { id: b.id } }))?.kanbanColumnId, cols.ESCALATED);
    assert.equal((await prisma.lead.findUnique({ where: { id: c.id } }))?.kanbanColumnId, cols.TRIAGE, "inbound aberto não se mexe");
    assert.equal(await prisma.leadActivity.count({ where: { leadId: { in: [a.id, b.id] } } }), 2);
  } finally {
    await limpar();
  }
});

test("lead de prospecção nasce em '1º Contato' (não em 'Novos')", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma, org, cols, limpar } = await fixture();
  const { garantirLeadDoProspect } = await import("@/lib/crm/pipeline-mover");
  try {
    const p = await prisma.prospectLead.create({ data: { organizationId: org.id, nome: "Loja Teste", telefone: "62911110009", updatedAt: new Date() } });
    const id = await garantirLeadDoProspect({ id: p.id, organizationId: org.id, nome: p.nome, telefone: p.telefone });
    assert.ok(id);
    const l = await prisma.lead.findUnique({ where: { id: id! } });
    assert.equal(l?.leadOrigin, "OUTBOUND");
    assert.equal(l?.kanbanColumnId, cols.CONTATO_1);
  } finally {
    await limpar();
  }
});

test("fila de ligações: marcadas pelo SDR + pendentes (escalados / ligue para o lead); concluído some", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma, org, mk, limpar } = await fixture();
  const { listarLigacoes } = await import("@/lib/crm/ligacoes");
  const amanha = new Date(Date.now() + 24 * 3_600_000);
  const d = await mk("5562911110004", "INBOUND", "ESCALATED", { empresa: "D Modas", reuniaoEm: amanha, dorPrincipal: "vende pouco no ML" });
  const b = await mk("5562911110005", "INBOUND", "ESCALATED");
  const c = await mk("5562911110006", "INBOUND", "OPEN");
  const nB = await prisma.ownerNotification.create({ data: { type: "ESCALATION", title: "🔥 Novo lead escalado", body: "x", organizationId: org.id, leadId: b.id } });
  await prisma.ownerNotification.create({ data: { type: "INFO", title: "📞 Lead parou de responder — ligue para L0006", body: "y", organizationId: org.id, leadId: c.id } });
  await prisma.ownerNotification.create({ data: { type: "INFO", title: "Resumo diário", body: "z", organizationId: org.id } });
  try {
    const fila = await listarLigacoes(org.id);
    assert.equal(fila.marcadas.length, 1);
    assert.equal(fila.marcadas[0].leadId, d.id);
    assert.equal(fila.marcadas[0].empresa, "D Modas");
    assert.equal(fila.pendentes.length, 2, "só escalados e 📞; resumo diário fica de fora");
    assert.ok(fila.pendentes.every((p) => p.telefone && p.nome.startsWith("L")));
    await prisma.ownerNotification.update({ where: { id: nB.id }, data: { read: true } });
    assert.equal((await listarLigacoes(org.id)).pendentes.length, 1);
    await prisma.$disconnect();
  } finally {
    await limpar();
  }
});
