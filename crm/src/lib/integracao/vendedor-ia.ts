// Eventos que o Vendedor IA envia ao CRM. Contrato em docs/integracao.md.
// Idempotente: o mesmo eventoId nunca é processado duas vezes.
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { motivoIdPorNome } from "@/lib/funil/motivos";
import { criarTarefa } from "@/lib/atividades/tarefas";
import { criarCompromisso } from "@/lib/atividades/compromissos";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { INTENCOES, type Intencao } from "@/lib/atividades/intencoes";

export interface EventoVendedorIa {
  eventoId: string;
  tipo: string;
  ocorridoEm?: string;
  /** lead.perdido / lead.ganho: nome do motivo do catálogo. */
  motivo?: string | null;
  /** reuniao.agendada: horário da ligação (ISO). */
  reuniaoEm?: string | null;
  /** intencao.detectada: um dos 13 sinais (ex.: OBJECAO_PRECO) e o trecho da mensagem que o gerou. */
  intencao?: string | null;
  texto?: string | null;
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
  if (e.intencao != null && !(INTENCOES as readonly string[]).includes(e.intencao as string)) return { ok: false, erro: "intencao desconhecida" };
  if (e.reuniaoEm != null && Number.isNaN(new Date(e.reuniaoEm).getTime())) return { ok: false, erro: "reuniaoEm inválido" };
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
    resultado = await tratar(evento);
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


type Lead = NonNullable<EventoVendedorIa["lead"]>;

async function tratar(e: EventoVendedorIa): Promise<ResultadoEvento> {
  if (!e.lead) return { status: "IGNORADO", detalhe: `tipo ${e.tipo} sem lead` };
  switch (e.tipo) {
    case "lead.qualificado": return leadQualificado(e.lead);
    case "lead.escalado": return leadEscalado(e.lead);
    case "reuniao.agendada": return reuniaoAgendada(e.lead, e.reuniaoEm);
    case "lead.perdido": return encerrar(e.lead, "PERDIDA", e.motivo);
    case "lead.ganho": return encerrar(e.lead, "GANHA", e.motivo);
    case "intencao.detectada": return intencaoDetectada(e.lead, e.intencao, e.texto);
    default: return { status: "IGNORADO", detalhe: `tipo ${e.tipo} ainda não tratado` };
  }
}

const abertaDoLead = (leadId: string) => prisma.oportunidade.findFirst({ where: { vendedorIaLeadId: leadId, status: "EM_ANDAMENTO" }, orderBy: { criadoEm: "desc" } });

/** Oportunidade em andamento do lead; se não houver, cria como em lead.qualificado. */
async function garantirAberta(lead: Lead): Promise<{ id: string; criada: boolean }> {
  const a = await abertaDoLead(lead.id);
  if (a) return { id: a.id, criada: false };
  const r = await leadQualificado(lead);
  if (!r.oportunidadeId) throw new Error("não foi possível abrir a oportunidade");
  return { id: r.oportunidadeId, criada: true };
}

async function primeiroAdmin() {
  return prisma.usuario.findFirst({ where: { papel: "ADMIN", ativo: true }, orderBy: { criadoEm: "asc" }, select: { id: true } });
}

async function leadEscalado(lead: Lead): Promise<ResultadoEvento> {
  const op = await garantirAberta(lead);
  const ja = await prisma.tarefa.findFirst({ where: { oportunidadeId: op.id, origem: "INTEGRACAO", status: "ABERTA", titulo: { startsWith: "Assumir a conversa" } }, select: { id: true } });
  if (ja) return { status: "IGNORADO", detalhe: "já existe tarefa de assumir a conversa", oportunidadeId: op.id };
  const admin = await primeiroAdmin();
  await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: "O Vendedor IA passou a conversa para uma pessoa.", autor: "vendedor-ia", autorNome: "Vendedor IA" });
  await criarTarefa({
    titulo: `Assumir a conversa de ${lead.nome?.trim() || "lead sem nome"}`, tipo: "WHATSAPP", prioridade: "ALTA",
    prazoEm: new Date(Date.now() + 3_600_000), oportunidadeId: op.id, responsavelId: admin?.id ?? null, origem: "INTEGRACAO",
  });
  return { status: "PROCESSADO", oportunidadeId: op.id };
}

async function reuniaoAgendada(lead: Lead, reuniaoEm?: string | null): Promise<ResultadoEvento> {
  if (!reuniaoEm) return { status: "IGNORADO", detalhe: "reuniaoEm ausente" };
  const op = await garantirAberta(lead);
  const inicio = new Date(reuniaoEm);
  const existe = await prisma.compromisso.findFirst({ where: { oportunidadeId: op.id, inicio, origem: "INTEGRACAO" }, select: { id: true } });
  if (existe) return { status: "IGNORADO", detalhe: "compromisso já existe", oportunidadeId: op.id };
  const admin = await primeiroAdmin();
  await criarCompromisso({
    assunto: `Ligação com ${lead.nome?.trim() || lead.empresa?.trim() || "lead"}`, tipo: "LIGACAO", inicio, fim: new Date(inicio.getTime() + 30 * 60_000),
    descricao: lead.dorPrincipal ? `Dor principal: ${lead.dorPrincipal}` : null, responsavelId: admin?.id ?? null, oportunidadeId: op.id, origem: "INTEGRACAO",
  });
  await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: "O Vendedor IA marcou a ligação com o especialista.", autor: "vendedor-ia", autorNome: "Vendedor IA" });
  return { status: "PROCESSADO", oportunidadeId: op.id };
}

async function encerrar(lead: Lead, natureza: "GANHA" | "PERDIDA", motivo?: string | null): Promise<ResultadoEvento> {
  const op = await abertaDoLead(lead.id);
  if (!op) return { status: "IGNORADO", detalhe: "sem oportunidade em andamento para este lead" };
  const etapa = await prisma.etapa.findFirst({ where: { funilId: op.funilId, tipo: natureza }, orderBy: { ordem: "asc" } });
  if (!etapa) return { status: "IGNORADO", detalhe: `funil sem etapa ${natureza}`, oportunidadeId: op.id };
  const motivoId = motivo ? await motivoIdPorNome(natureza === "GANHA" ? "GANHO" : "PERDA", motivo) : null;
  await moverOportunidade({ oportunidadeId: op.id, etapaId: etapa.id, origem: "INTEGRACAO", ator: "vendedor-ia", motivo: motivo ? `Vendedor IA: ${motivo}` : "Vendedor IA", motivoId });
  return { status: "PROCESSADO", oportunidadeId: op.id };
}

async function intencaoDetectada(lead: Lead, intencao?: string | null, texto?: string | null): Promise<ResultadoEvento> {
  if (!intencao) return { status: "IGNORADO", detalhe: "intencao ausente" };
  const op = await abertaDoLead(lead.id);
  if (!op) return { status: "IGNORADO", detalhe: "sem oportunidade em andamento para este lead" };
  await registrarFeedback({
    oportunidadeId: op.id, tipo: "WHATSAPP", texto: (texto ?? "").trim().slice(0, 500) || "Sinal detectado na conversa.",
    intencao: intencao as Intencao, autor: "vendedor-ia", autorNome: "Vendedor IA",
  });
  return { status: "PROCESSADO", oportunidadeId: op.id };
}
