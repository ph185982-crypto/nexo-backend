// Consultas somente leitura por trás do servidor MCP (/api/mcp). Usam o mesmo
// Prisma client e os mesmos modelos que o resto do app (Lead, KanbanColumn,
// WhatsappBusinessOrganization) — nenhuma fonte de dados paralela.
//
// Nota sobre "contratos": este schema não tem uma tabela Contrato separada.
// O funil de vendas (KanbanColumn.type) já modela isso como estágio do lead —
// CONTRATO é a etapa "contrato assinado/em assinatura" e GANHO é "negócio
// fechado". listar_contratos() lista os leads nessas duas etapas.

import { prisma } from "@/lib/prisma/client";

export const LIMITE_REGISTROS = 100;

export type Periodo = "hoje" | "7d" | "30d" | "90d" | "todos";

/** Converte o período pedido num corte de data (null = sem filtro). */
export function inicioDoPeriodo(periodo?: string): Date | null {
  const agora = new Date();
  switch (periodo) {
    case "hoje": {
      const d = new Date(agora); d.setHours(0, 0, 0, 0); return d;
    }
    case "7d": return new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "90d": return new Date(agora.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "todos": return null;
    case "30d":
    case undefined:
    case "":
      return new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      // Aceita também uma data ISO (ex.: "2026-01-01") como corte manual.
      const d = new Date(periodo);
      return Number.isNaN(d.getTime()) ? new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000) : d;
  }
}

export async function listarLeads(periodo?: string) {
  const desde = inicioDoPeriodo(periodo);
  const leads = await prisma.lead.findMany({
    where: desde ? { createdAt: { gte: desde } } : {},
    orderBy: { createdAt: "desc" },
    take: LIMITE_REGISTROS,
    select: {
      id: true,
      profileName: true,
      phoneNumber: true,
      leadOrigin: true,
      status: true,
      createdAt: true,
      lastActivityAt: true,
      organization: { select: { name: true } },
      kanbanColumn: { select: { name: true, type: true } },
    },
  });

  return leads.map((l) => ({
    id: l.id,
    nome: l.profileName ?? "—",
    telefone: l.phoneNumber,
    origem: l.leadOrigin,
    status: l.status,
    organizacao: l.organization.name,
    etapaFunil: l.kanbanColumn.name,
    criadoEm: l.createdAt,
    ultimaAtividadeEm: l.lastActivityAt,
  }));
}

export async function metricasFunil(periodo?: string) {
  const desde = inicioDoPeriodo(periodo);

  const [colunas, contagens] = await Promise.all([
    prisma.kanbanColumn.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true, type: true, organizationId: true },
    }),
    prisma.lead.groupBy({
      by: ["kanbanColumnId"],
      where: desde ? { createdAt: { gte: desde } } : {},
      _count: { _all: true },
    }),
  ]);

  const porColuna = new Map(contagens.map((c) => [c.kanbanColumnId, c._count._all]));
  const funil = colunas
    .map((c) => ({ coluna: c.name, etapa: c.type, quantidade: porColuna.get(c.id) ?? 0 }))
    .filter((c) => c.quantidade > 0 || porColuna.size === 0);

  const total = funil.reduce((soma, c) => soma + c.quantidade, 0);

  return { periodo: periodo ?? "30d", total, etapas: funil.slice(0, LIMITE_REGISTROS) };
}

export async function buscarCliente(nomeOuCnpj: string) {
  const termo = (nomeOuCnpj ?? "").trim();
  if (!termo) return [];
  const digitos = termo.replace(/\D/g, "");

  const [leads, organizacoes] = await Promise.all([
    prisma.lead.findMany({
      where: {
        OR: [
          { profileName: { contains: termo, mode: "insensitive" } },
          ...(digitos.length >= 4 ? [{ phoneNumber: { contains: digitos } }, { cpf: { contains: digitos } }] : []),
          { cpf: { contains: termo } },
        ],
      },
      take: LIMITE_REGISTROS,
      select: {
        id: true, profileName: true, phoneNumber: true, cpf: true, status: true,
        organization: { select: { name: true } },
      },
    }),
    prisma.whatsappBusinessOrganization.findMany({
      where: {
        OR: [
          { name: { contains: termo, mode: "insensitive" } },
          ...(digitos.length >= 4 ? [{ documentId: { contains: digitos } }] : []),
          { documentId: { contains: termo } },
        ],
      },
      take: LIMITE_REGISTROS,
      select: { id: true, name: true, documentId: true, documentType: true, status: true },
    }),
  ]);

  const resultado = [
    ...leads.map((l) => ({
      tipo: "lead" as const,
      id: l.id,
      nome: l.profileName ?? "—",
      documentoOuTelefone: l.cpf ?? l.phoneNumber,
      organizacao: l.organization.name,
      status: l.status,
    })),
    ...organizacoes.map((o) => ({
      tipo: "organizacao" as const,
      id: o.id,
      nome: o.name,
      documentoOuTelefone: `${o.documentType}: ${o.documentId}`,
      organizacao: o.name,
      status: o.status,
    })),
  ];

  return resultado.slice(0, LIMITE_REGISTROS);
}

const ETAPAS_CONTRATO = ["CONTRATO", "GANHO"] as const;
const STATUS_LEAD_VALIDOS = ["OPEN", "ESCALATED", "CLOSED", "BLOCKED"] as const;

export async function listarContratos(status?: string) {
  const statusNormalizado = status?.trim().toUpperCase();
  const statusValido = STATUS_LEAD_VALIDOS.includes(statusNormalizado as (typeof STATUS_LEAD_VALIDOS)[number])
    ? statusNormalizado
    : undefined;

  const leads = await prisma.lead.findMany({
    where: {
      kanbanColumn: { type: { in: [...ETAPAS_CONTRATO] } },
      ...(statusValido ? { status: statusValido } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: LIMITE_REGISTROS,
    select: {
      id: true, profileName: true, phoneNumber: true, status: true, updatedAt: true,
      organization: { select: { name: true } },
      kanbanColumn: { select: { name: true, type: true } },
    },
  });

  return leads.map((l) => ({
    id: l.id,
    cliente: l.profileName ?? "—",
    telefone: l.phoneNumber,
    organizacao: l.organization.name,
    etapa: l.kanbanColumn.type,
    status: l.status,
    atualizadoEm: l.updatedAt,
  }));
}
