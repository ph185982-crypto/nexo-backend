// Eventos que o Vendedor IA envia ao CRM. Contrato em docs/integracao.md.
// Idempotente: o mesmo eventoId nunca é processado duas vezes.
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";

export interface EventoVendedorIa {
  eventoId: string;
  tipo: string;
  ocorridoEm?: string;
  lead?: {
    id: string;
    telefone?: string | null;
    nome?: string | null;
    email?: string | null;
    empresa?: string | null;
    segmento?: string | null;
    faturamentoMensal?: number | null;
    dorPrincipal?: string | null;
    origem?: string | null;
    scoreSdr?: number | null;
  };
}

export type ResultadoEvento = { status: "PROCESSADO" | "IGNORADO" | "DUPLICADO"; detalhe?: string; oportunidadeId?: string };

export function validarEvento(corpo: unknown): { ok: true; evento: EventoVendedorIa } | { ok: false; erro: string } {
  const e = corpo as Partial<EventoVendedorIa> | null;
  if (!e || typeof e !== "object") return { ok: false, erro: "Corpo inválido" };
  if (typeof e.eventoId !== "string" || e.eventoId.length < 8 || e.eventoId.length > 120) return { ok: false, erro: "eventoId obrigatório (8–120 caracteres)" };
  if (typeof e.tipo !== "string" || !/^[a-z]+(\.[a-z_]+)+$/.test(e.tipo)) return { ok: false, erro: "tipo inválido" };
  if (e.lead !== undefined && (typeof e.lead !== "object" || e.lead === null || typeof e.lead.id !== "string" || !e.lead.id)) return { ok: false, erro: "lead.id obrigatório quando lead é enviado" };
  return { ok: true, evento: e as EventoVendedorIa };
}

/** Só dígitos; com 10 ou 11 dígitos (sem DDI) assume Brasil. */
export function normalizarTelefone(t: string | null | undefined): string | null {
  const d = (t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.length <= 11 ? `55${d}` : d;
}

export async function processarEventoVendedorIa(evento: EventoVendedorIa): Promise<ResultadoEvento> {
  const ja = await prisma.eventoIntegracao.findUnique({ where: { eventoId: evento.eventoId } });
  if (ja) return { status: "DUPLICADO", detalhe: `já recebido como ${ja.status}` };

  let resultado: ResultadoEvento;
  try {
    resultado = evento.tipo === "lead.qualificado" && evento.lead ? await leadQualificado(evento.lead) : { status: "IGNORADO", detalhe: `tipo ${evento.tipo} ainda não tratado` };
  } catch (e) {
    await prisma.eventoIntegracao.create({ data: { eventoId: evento.eventoId, origem: "vendedor-ia", tipo: evento.tipo, payload: evento as object, status: "ERRO", detalhe: String(e).slice(0, 500) } });
    throw e;
  }
  await prisma.eventoIntegracao.create({
    data: { eventoId: evento.eventoId, origem: "vendedor-ia", tipo: evento.tipo, payload: evento as object, status: resultado.status, detalhe: resultado.detalhe ?? null },
  });
  return resultado;
}

async function leadQualificado(lead: NonNullable<EventoVendedorIa["lead"]>): Promise<ResultadoEvento> {
  // Um lead do Vendedor IA tem no máximo uma oportunidade em andamento.
  const aberta = await prisma.oportunidade.findFirst({ where: { vendedorIaLeadId: lead.id, status: "EM_ANDAMENTO" }, select: { id: true } });
  if (aberta) return { status: "IGNORADO", detalhe: "já existe oportunidade em andamento para este lead", oportunidadeId: aberta.id };

  const telefone = normalizarTelefone(lead.telefone);
  const nome = (lead.nome ?? "").trim() || (telefone ? `Lead ${telefone.slice(-4)}` : "Lead sem nome");

  let pessoa = await prisma.contato.findUnique({ where: { vendedorIaLeadId: lead.id } });
  if (!pessoa && telefone) pessoa = await prisma.contato.findFirst({ where: { telefone, tipo: "PESSOA" } });
  if (!pessoa) {
    pessoa = await prisma.contato.create({
      data: { tipo: "PESSOA", nome, telefone, email: lead.email ?? null, origem: lead.origem ?? "Vendedor IA", vendedorIaLeadId: lead.id },
    });
  } else if (!pessoa.vendedorIaLeadId) {
    pessoa = await prisma.contato.update({ where: { id: pessoa.id }, data: { vendedorIaLeadId: lead.id } });
  }

  let empresa = null;
  const nomeEmpresa = lead.empresa?.trim();
  if (nomeEmpresa) {
    empresa = await prisma.contato.findFirst({ where: { tipo: "EMPRESA", nome: { equals: nomeEmpresa, mode: "insensitive" } } })
      ?? await prisma.contato.create({ data: { tipo: "EMPRESA", nome: nomeEmpresa, segmento: lead.segmento ?? null, origem: lead.origem ?? "Vendedor IA" } });
    if (pessoa.empresaId !== empresa.id) await prisma.contato.update({ where: { id: pessoa.id }, data: { empresaId: empresa.id } });
  }

  const funil = await prisma.funil.findFirst({ where: { padrao: true, ativo: true }, orderBy: { ordem: "asc" }, include: { etapas: { orderBy: { ordem: "asc" } } } });
  if (!funil) throw new Error("Nenhum funil padrão configurado");
  const abertas = funil.etapas.filter((e) => e.tipo === "ABERTA");
  const etapa = abertas.find((e) => /qualifica/i.test(e.nome)) ?? abertas[0];
  if (!etapa) throw new Error("Funil padrão sem etapa aberta");

  const op = await criarOportunidade({
    nome: `${empresa?.nome ?? pessoa.nome} — qualificado pelo Vendedor IA`,
    contatoId: empresa?.id ?? pessoa.id,
    pessoaId: pessoa.id,
    etapaId: etapa.id,
    origem: lead.origem ?? "Vendedor IA",
    tags: ["vendedor-ia"],
    vendedorIaLeadId: lead.id,
    origemHistorico: "INTEGRACAO",
    ator: "vendedor-ia",
  });
  return { status: "PROCESSADO", oportunidadeId: op.id };
}
