import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

const ITENS_PADRAO: Array<{ titulo: string; pilar: string; prazoDias: number; cliente?: boolean; descricao?: string; checklist?: string[] }> = [
  { titulo: "Reunião de kickoff com o dono", pilar: "COMERCIAL", prazoDias: 3, descricao: "Alinhar objetivo, escopo, prazos e quem decide.", checklist: ["Confirmar a meta do trimestre", "Combinar a rotina de acompanhamento"] },
  { titulo: "Enviar acessos e documentos", pilar: "OPERACAO", prazoDias: 5, cliente: true, descricao: "Anúncios, CRM atual, planilhas e extrato do último trimestre.", checklist: ["Acesso ao gerenciador de anúncios", "Planilhas de vendas", "Extrato financeiro"] },
  { titulo: "Mapear funil e metas comerciais", pilar: "COMERCIAL", prazoDias: 14 },
  { titulo: "Auditar anúncios e canais de entrada", pilar: "MARKETING", prazoDias: 14 },
  { titulo: "Diagnóstico de margem e fluxo de caixa", pilar: "FINANCEIRO", prazoDias: 14 },
  { titulo: "Revisar oferta e precificação", pilar: "PRODUTO", prazoDias: 21 },
  { titulo: "Mapear processos críticos", pilar: "OPERACAO", prazoDias: 21 },
  { titulo: "Configurar CRM e rotinas de acompanhamento", pilar: "TECNOLOGIA", prazoDias: 30 },
];

export const NOME_MODELO_PADRAO = "Consultoria Avanteza — implantação";

/** Cria o modelo padrão se não existir nenhum modelo padrão. Idempotente. */
export async function garantirModeloPadrao(db: Db = prisma) {
  const existente = await db.modeloEntrega.findFirst({ where: { padrao: true, ativo: true } });
  if (existente) return existente;
  return db.modeloEntrega.upsert({
    where: { nome: NOME_MODELO_PADRAO },
    update: { padrao: true, ativo: true },
    create: {
      nome: NOME_MODELO_PADRAO, padrao: true, descricao: "Cartões por pilar para os primeiros 30 dias de uma implantação.",
      itens: { create: ITENS_PADRAO.map((i, ordem) => ({ titulo: i.titulo, pilar: i.pilar, prazoDias: i.prazoDias, cliente: i.cliente ?? false, descricao: i.descricao ?? null, ordem, checklist: (i.checklist ?? []).map((t) => ({ texto: t, feito: false })) })) },
    },
  });
}

/** Só um modelo é o padrão por vez. */
export async function definirModeloPadrao(id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.modeloEntrega.updateMany({ where: { padrao: true, id: { not: id } }, data: { padrao: false } });
    return tx.modeloEntrega.update({ where: { id }, data: { padrao: true, ativo: true } });
  });
}
