// Dados do kanban: etapas abertas + coluna "Finalizadas no mês" (ganhas e perdidas).
import { prisma } from "@/lib/prisma";
import { codigoOportunidade } from "./encerramento";
import { lerPeriodo } from "@/lib/relatorios/periodo";

export interface CartaoDTO {
  id: string;
  codigo: string;
  nome: string;
  etapaId: string;
  status: string;
  contato: { id: string; nome: string };
  pessoa: { id: string; nome: string } | null;
  responsavel: string | null;
  valorUnico: number;
  valorMensal: number;
  valorTotal: number;
  probabilidade: string | null;
  origem: string | null;
  tags: string[];
  finalizaEm: string | null;
  criadoEm: string;
  etapaDesdeEm: string;
  ultimaAtividadeEm: string;
  encerradaEm: string | null;
  motivo: string | null;
  motivoDetalhe: string | null;
  vendedorIaLeadId: string | null;
  /** Id da entrega, quando a oportunidade foi ganha. */
  entregaId: string | null;
  /** Próximo prazo entre tarefas abertas e compromissos futuros; null se nada à vista. */
  proximaAtividade: { tipo: "TAREFA" | "COMPROMISSO"; quando: string | null } | null;
}

export interface EtapaDTO {
  id: string;
  nome: string;
  tipo: string;
  descricao: string | null;
  quantidade: number;
  total: number;
  oportunidades: CartaoDTO[];
}

export interface QuadroDTO {
  funil: { id: string; nome: string };
  /** Etapas abertas, na ordem do funil. */
  etapas: EtapaDTO[];
  /** Etapas de ganho e perda, com o que foi encerrado no mês de `mes`. */
  finalizadas: { mes: string; etapas: EtapaDTO[] };
}

const num = (d: { toString(): string } | null | undefined) => (d ? Number(d.toString()) : 0);

export async function montarQuadro(funilId: string, agora: Date = new Date()): Promise<QuadroDTO | null> {
  const funil = await prisma.funil.findUnique({
    where: { id: funilId },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });
  if (!funil) return null;

  const inicioMes = lerPeriodo(null, null, agora).de; // mês de Brasília, o mesmo dos relatórios e metas
  const ops = await prisma.oportunidade.findMany({
    where: {
      funilId,
      OR: [{ status: "EM_ANDAMENTO" }, { status: { in: ["GANHA", "PERDIDA"] }, encerradaEm: { gte: inicioMes } }],
    },
    include: { contato: { select: { id: true, nome: true } }, pessoa: { select: { id: true, nome: true } }, responsavel: { select: { nome: true } }, motivo: { select: { nome: true } } },
    orderBy: { etapaDesdeEm: "asc" },
  });

  const ids = ops.filter((o) => o.status === "EM_ANDAMENTO").map((o) => o.id);
  const [tarefasAbertas, compromissosFuturos] = await Promise.all([
    prisma.tarefa.findMany({ where: { oportunidadeId: { in: ids }, status: "ABERTA" }, select: { oportunidadeId: true, prazoEm: true }, orderBy: { prazoEm: { sort: "asc", nulls: "last" } } }),
    prisma.compromisso.findMany({ where: { oportunidadeId: { in: ids }, status: "AGENDADO", inicio: { gte: agora } }, select: { oportunidadeId: true, inicio: true }, orderBy: { inicio: "asc" } }),
  ]);
  const entregas = await prisma.entrega.findMany({ where: { oportunidadeId: { in: ops.filter((o) => o.status === "GANHA").map((o) => o.id) } }, select: { id: true, oportunidadeId: true } });
  const entregaDe = new Map(entregas.map((e) => [e.oportunidadeId, e.id]));
  const proxima = new Map<string, CartaoDTO["proximaAtividade"]>();
  for (const t of tarefasAbertas) if (t.oportunidadeId && !proxima.has(t.oportunidadeId)) proxima.set(t.oportunidadeId, { tipo: "TAREFA", quando: t.prazoEm?.toISOString() ?? null });
  for (const c of compromissosFuturos) {
    if (!c.oportunidadeId) continue;
    const atual = proxima.get(c.oportunidadeId);
    if (!atual || !atual.quando || c.inicio.toISOString() < atual.quando) proxima.set(c.oportunidadeId, { tipo: "COMPROMISSO", quando: c.inicio.toISOString() });
  }

  const cartao = (o: (typeof ops)[number]): CartaoDTO => ({
    id: o.id,
    codigo: codigoOportunidade(o.numero, o.criadoEm),
    nome: o.nome,
    etapaId: o.etapaId,
    status: o.status,
    contato: o.contato,
    pessoa: o.pessoa,
    responsavel: o.responsavel?.nome ?? null,
    valorUnico: num(o.valorUnico),
    valorMensal: num(o.valorMensal),
    valorTotal: num(o.valorUnico) + num(o.valorMensal),
    probabilidade: o.probabilidade,
    origem: o.origem,
    tags: o.tags,
    finalizaEm: o.finalizaEm?.toISOString() ?? null,
    criadoEm: o.criadoEm.toISOString(),
    etapaDesdeEm: o.etapaDesdeEm.toISOString(),
    ultimaAtividadeEm: o.ultimaAtividadeEm.toISOString(),
    encerradaEm: o.encerradaEm?.toISOString() ?? null,
    motivo: o.motivo?.nome ?? null,
    motivoDetalhe: o.motivoDetalhe,
    vendedorIaLeadId: o.vendedorIaLeadId,
    entregaId: entregaDe.get(o.id) ?? null,
    proximaAtividade: proxima.get(o.id) ?? null,
  });

  const porEtapa = (e: (typeof funil.etapas)[number]): EtapaDTO => {
    const lista = ops.filter((o) => o.etapaId === e.id).map(cartao);
    return { id: e.id, nome: e.nome, tipo: e.tipo, descricao: e.descricao, quantidade: lista.length, total: lista.reduce((s, c) => s + c.valorTotal, 0), oportunidades: lista };
  };

  return {
    funil: { id: funil.id, nome: funil.nome },
    etapas: funil.etapas.filter((e) => e.tipo === "ABERTA").map(porEtapa),
    finalizadas: {
      mes: `${inicioMes.getUTCFullYear()}-${String(inicioMes.getUTCMonth() + 1).padStart(2, "0")}`, // dia 1 às 03:00 UTC: ano e mês de Brasília
      etapas: funil.etapas.filter((e) => e.tipo !== "ABERTA").map(porEtapa),
    },
  };
}
