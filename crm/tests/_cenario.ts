// Funil de teste isolado (nome único) com limpeza no fim.
import { prisma } from "@/lib/prisma";

export async function cenario(padrao = false) {
  const marca = `t${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const funil = await prisma.funil.create({ data: { nome: `Funil ${marca}`, padrao, ordem: padrao ? -1 : 99 } });  // o padrão de teste vence qualquer funil padrão já semeado
  const mk = (nome: string, ordem: number, tipo = "ABERTA") => prisma.etapa.create({ data: { funilId: funil.id, nome, ordem, tipo } });
  const leads = await mk("Leads", 0);
  const qualif = await mk("Qualificação", 1);
  const proposta = await mk("Proposta e negociação", 2);
  const ganha = await mk("Ganha", 3, "GANHA");
  const perdida = await mk("Perdida", 4, "PERDIDA");
  const contato = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: `Empresa ${marca}` } });
  const historico = (oportunidadeId: string) => prisma.historicoEtapa.findMany({ where: { oportunidadeId }, orderBy: [{ entrouEm: "asc" }, { id: "asc" }] });
  const limpar = async () => {
    const ops = await prisma.oportunidade.findMany({ where: { funilId: funil.id }, select: { id: true } });
    await prisma.oportunidade.deleteMany({ where: { id: { in: ops.map((o) => o.id) } } }); // histórico cai em cascata
    await prisma.eventoIntegracao.deleteMany({ where: { payload: { path: ["marca"], equals: marca } } });
    await prisma.contato.deleteMany({ where: { OR: [{ id: contato.id }, { nome: { contains: marca } }, { origem: marca }] } });
    await prisma.funil.delete({ where: { id: funil.id } });
  };
  return { prisma, marca, funil, leads, qualif, proposta, ganha, perdida, contato, historico, limpar };
}
