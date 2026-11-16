// Funil de teste isolado (nome único) com limpeza no fim.
import { prisma } from "@/lib/prisma/client";

/** O Comercial usa a organização do Vendedor IA (motivos, agenda): garante que exista uma (banco limpo da CI). */
export async function garantirOrganizacao(): Promise<string> {
  const org = await prisma.whatsappBusinessOrganization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return org?.id ?? (await prisma.whatsappBusinessOrganization.create({ data: { name: "Comercial (teste)", documentId: "0", documentType: "CNPJ" } })).id;
}

/** Lead de teste do Vendedor IA (para a ponte Lead ↔ Comercial). Devolve o id e a limpeza. */
export async function criarLeadDeTeste(marca: string, tipoColuna = "TRIAGE") {
  const organizationId = await garantirOrganizacao();
  const coluna = (await prisma.kanbanColumn.findFirst({ where: { organizationId, type: tipoColuna } }))
    ?? (await prisma.kanbanColumn.create({ data: { name: `Col ${marca}`, order: 90, type: tipoColuna, color: "#0b1b33", organizationId } }));
  const lead = await prisma.lead.create({ data: { phoneNumber: `55${Date.now() % 1e11}`, profileName: `Lead ${marca}`, leadOrigin: "INBOUND", organizationId, kanbanColumnId: coluna.id } });
  return { leadId: lead.id, limpar: () => prisma.lead.delete({ where: { id: lead.id } }).catch(() => {}) };
}

export async function cenario(padrao = false) {
  await garantirOrganizacao();
  const marca = `t${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const funil = await prisma.comFunil.create({ data: { nome: `Funil ${marca}`, padrao, ordem: padrao ? -1 : 99 } });  // o padrão de teste vence qualquer funil padrão já semeado
  const mk = (nome: string, ordem: number, tipo = "ABERTA") => prisma.comEtapa.create({ data: { funilId: funil.id, nome, ordem, tipo } });
  const leads = await mk("Leads", 0);
  const qualif = await mk("Qualificação", 1);
  const proposta = await mk("Proposta e negociação", 2);
  const ganha = await mk("Ganha", 3, "GANHA");
  const perdida = await mk("Perdida", 4, "PERDIDA");
  const contato = await prisma.comContato.create({ data: { tipo: "EMPRESA", nome: `Empresa ${marca}` } });
  const historico = (oportunidadeId: string) => prisma.comHistoricoEtapa.findMany({ where: { oportunidadeId }, orderBy: [{ entrouEm: "asc" }, { id: "asc" }] });
  const limpar = async () => {
    const ops = await prisma.comOportunidade.findMany({ where: { funilId: funil.id }, select: { id: true } });
    await prisma.comOportunidade.deleteMany({ where: { id: { in: ops.map((o) => o.id) } } }); // histórico cai em cascata
    await prisma.comEventoIntegracao.deleteMany({ where: { payload: { path: ["marca"], equals: marca } } });
    await prisma.comContato.deleteMany({ where: { OR: [{ id: contato.id }, { nome: { contains: marca } }, { origem: marca }] } });
    await prisma.comFunil.delete({ where: { id: funil.id } });
  };
  return { prisma, marca, funil, leads, qualif, proposta, ganha, perdida, contato, historico, limpar };
}
