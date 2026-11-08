// Combinados: criar, aceitar (materializa), descartar, marcar como entregue e levar para a entrega ao ganhar.
//
// Aceitar um combinado cria o item de trabalho que o acompanha:
//   reunião com data            → compromisso na agenda
//   oportunidade já ganha       → cartão no funil de entrega (prazo, pilar, "depende do cliente")
//   ainda em negociação         → tarefa (para o cliente: "Acompanhar com o cliente: …")
// Concluir o cartão ou a tarefa marca o combinado como entregue (e vice-versa).
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { primeiroAdminAtivo } from "@/lib/auth/admin";
import { criarTarefa, concluirTarefa } from "@/lib/atividades/tarefas";
import { criarCompromisso } from "@/lib/atividades/compromissos";
import { criarCartao, moverCartao } from "@/lib/entrega/servico";
import type { DadosCombinado } from "./modelo";

const HORA = 3_600_000;

type CombinadoRegistro = NonNullable<Awaited<ReturnType<typeof prisma.combinado.findUnique>>>;

export async function listarCombinados(oportunidadeId: string) {
  const [combinados, analises] = await Promise.all([
    prisma.combinado.findMany({ where: { oportunidadeId, status: { not: "APLICADA" } }, orderBy: [{ prazoEm: { sort: "asc", nulls: "last" } }, { criadoEm: "desc" }] }),
    prisma.analiseAgente.findMany({ where: { oportunidadeId }, orderBy: { criadoEm: "desc" }, take: 10, select: { id: true, fonte: true, status: true, resumo: true, erro: true, sugestoes: true, criadoEm: true, concluidaEm: true } }),
  ]);
  return {
    sugeridos: combinados.filter((c) => c.status === "SUGERIDO"),
    pendentes: combinados.filter((c) => c.status === "PENDENTE"),
    entregues: combinados.filter((c) => c.status === "ENTREGUE"),
    analises,
  };
}

async function donoDaOportunidade(oportunidadeId: string, usuarioId: string | null) {
  const op = await prisma.oportunidade.findUnique({ where: { id: oportunidadeId }, select: { responsavelId: true, entrega: { select: { id: true, status: true } } } });
  if (!op) throw new ErroEntrada("Oportunidade não encontrada");
  const dono = op.responsavelId ?? usuarioId ?? (await primeiroAdminAtivo())?.id ?? null;
  const entrega = op.entrega && op.entrega.status !== "CANCELADA" ? op.entrega : null;
  return { dono, entrega };
}

/** Cria o item de trabalho de um combinado aceito. Devolve os ids para gravar no combinado. */
async function materializar(c: CombinadoRegistro, usuarioId: string | null): Promise<{ cartaoId?: string; tarefaId?: string; compromissoId?: string }> {
  const { dono, entrega } = await donoDaOportunidade(c.oportunidadeId, usuarioId);
  if (c.tipo === "REUNIAO" && c.prazoEm) {
    const k = await criarCompromisso({ assunto: c.descricao, tipo: "REUNIAO", inicio: c.prazoEm, fim: new Date(c.prazoEm.getTime() + HORA), oportunidadeId: c.oportunidadeId, responsavelId: dono, descricao: c.evidencia ? `Combinado: "${c.evidencia}"` : null });
    return { compromissoId: k.id };
  }
  if (entrega) {
    const k = await criarCartao({ entregaId: entrega.id, titulo: c.descricao, pilar: c.pilar ?? "COMERCIAL", dataAlvo: c.prazoEm, cliente: c.responsavel === "CLIENTE", responsavelId: dono, descricao: c.evidencia ? `Combinado: "${c.evidencia}"` : null });
    return { cartaoId: k.id };
  }
  const titulo = c.tipo === "REUNIAO" ? `Marcar: ${c.descricao}` : c.responsavel === "CLIENTE" ? `Acompanhar com o cliente: ${c.descricao}` : c.descricao;
  const t = await criarTarefa({ titulo: titulo.slice(0, 200), prazoEm: c.prazoEm, oportunidadeId: c.oportunidadeId, responsavelId: dono, origem: "MANUAL", descricao: c.evidencia ? `Combinado: "${c.evidencia}"` : null });
  return { tarefaId: t.id };
}

/** Combinado escrito à mão: já nasce aceito (pendente) e com seu item de trabalho. */
export async function criarCombinadoManual(oportunidadeId: string, d: DadosCombinado, usuarioId: string | null) {
  const c = await prisma.combinado.create({ data: { oportunidadeId, ...d, status: "PENDENTE", origem: "MANUAL", decididoEm: new Date(), decididoPorId: usuarioId } });
  const ids = await materializar(c, usuarioId);
  return prisma.combinado.update({ where: { id: c.id }, data: ids });
}

/**
 * Aceita uma sugestão (com ajustes opcionais feitos na tela). NOVO vira combinado pendente com item de trabalho;
 * CONCLUIR e ATUALIZAR_PRAZO agem sobre o item alvo e a sugestão fica APLICADA. Duas aceitações ao mesmo tempo: só uma vale.
 */
export async function aceitarCombinado(id: string, usuarioId: string | null, ajustes: Partial<DadosCombinado> = {}, agora: Date = new Date()) {
  const c = await prisma.combinado.findUnique({ where: { id } });
  if (!c) throw new ErroEntrada("Combinado não encontrado");
  if (c.status !== "SUGERIDO") throw new ErroEntrada("Este combinado já foi decidido");
  const novoStatus = c.acao === "NOVO" ? "PENDENTE" : "APLICADA";
  const claim = await prisma.combinado.updateMany({ where: { id, status: "SUGERIDO" }, data: { ...ajustes, status: novoStatus, decididoEm: agora, decididoPorId: usuarioId } });
  if (claim.count === 0) throw new ErroEntrada("Este combinado já foi decidido");
  try {
    if (c.acao === "NOVO") {
      const atual = (await prisma.combinado.findUnique({ where: { id } }))!;
      return await prisma.combinado.update({ where: { id }, data: await materializar(atual, usuarioId) });
    }
    if (c.acao === "CONCLUIR") {
      if (c.alvoCombinadoId) await marcarEntregue(c.alvoCombinadoId, agora);
      else if (c.alvoCartaoId) await concluirCartao(c.alvoCartaoId, agora);
    } else if (c.acao === "ATUALIZAR_PRAZO") {
      const prazo = ajustes.prazoEm ?? c.prazoEm;
      if (!prazo) throw new ErroEntrada("A sugestão não tem o novo prazo");
      if (c.alvoCombinadoId) await editarCombinado(c.alvoCombinadoId, { prazoEm: prazo });
      else if (c.alvoCartaoId) await prisma.entregaCartao.update({ where: { id: c.alvoCartaoId }, data: { dataAlvo: prazo } });
    }
    return (await prisma.combinado.findUnique({ where: { id } }))!;
  } catch (e) {
    // Não conseguiu aplicar: volta a ser sugestão, para a pessoa tentar de novo ou descartar.
    await prisma.combinado.update({ where: { id }, data: { status: "SUGERIDO", decididoEm: null, decididoPorId: null } });
    throw e;
  }
}

export async function descartarCombinado(id: string, usuarioId: string | null) {
  const r = await prisma.combinado.updateMany({ where: { id, status: { in: ["SUGERIDO", "PENDENTE"] } }, data: { status: "DESCARTADO", decididoEm: new Date(), decididoPorId: usuarioId } });
  if (r.count === 0) throw new ErroEntrada("Só dá para descartar um combinado sugerido ou pendente");
}

async function concluirCartao(cartaoId: string, agora: Date) {
  const k = await prisma.entregaCartao.findUnique({ where: { id: cartaoId }, select: { coluna: true } });
  if (k && k.coluna !== "CONCLUIDO") await moverCartao(cartaoId, "CONCLUIDO", undefined, agora);
}

/** Cumprido: marca o combinado e conclui o cartão e a tarefa ligados a ele. */
export async function marcarEntregue(id: string, agora: Date = new Date()) {
  const c = await prisma.combinado.findUnique({ where: { id } });
  if (!c) throw new ErroEntrada("Combinado não encontrado");
  if (c.status === "ENTREGUE") return c;
  if (c.status !== "PENDENTE") throw new ErroEntrada("Só um combinado pendente pode ser marcado como entregue");
  await prisma.combinado.update({ where: { id }, data: { status: "ENTREGUE", entregueEm: agora } });
  if (c.cartaoId) await concluirCartao(c.cartaoId, agora);
  if (c.tarefaId) {
    const t = await prisma.tarefa.findUnique({ where: { id: c.tarefaId }, select: { status: true } });
    if (t && t.status !== "CONCLUIDA") await concluirTarefa(c.tarefaId, agora);
  }
  return (await prisma.combinado.findUnique({ where: { id } }))!;
}

/** Edita o combinado e leva o novo prazo/descrição para o cartão e a tarefa ligados. */
export async function editarCombinado(id: string, d: Partial<DadosCombinado>) {
  const c = await prisma.combinado.update({ where: { id }, data: d });
  if (c.cartaoId && (d.prazoEm !== undefined || d.descricao !== undefined)) {
    await prisma.entregaCartao.update({ where: { id: c.cartaoId }, data: { ...(d.prazoEm !== undefined && { dataAlvo: d.prazoEm }), ...(d.descricao !== undefined && { titulo: d.descricao }) } }).catch(() => {});
  }
  if (c.tarefaId && d.prazoEm !== undefined) await prisma.tarefa.update({ where: { id: c.tarefaId }, data: { prazoEm: d.prazoEm } }).catch(() => {});
  return c;
}

/**
 * Ganhou: o que foi combinado na negociação e ainda está pendente vira cartão da entrega (o plano de ação do
 * cliente já nasce com o que foi prometido). Idempotente: combinado que já tem cartão não ganha outro.
 */
export async function levarCombinadosParaEntrega(oportunidadeId: string): Promise<number> {
  const { dono, entrega } = await donoDaOportunidade(oportunidadeId, null);
  if (!entrega) return 0;
  const lista = await prisma.combinado.findMany({ where: { oportunidadeId, status: "PENDENTE", acao: "NOVO", cartaoId: null, tipo: { not: "REUNIAO" } }, orderBy: { criadoEm: "asc" } });
  let n = 0;
  for (const c of lista) {
    // Reserva antes de criar: duas chamadas ao mesmo tempo não criam dois cartões.
    const reserva = await prisma.combinado.updateMany({ where: { id: c.id, cartaoId: null }, data: { cartaoId: "reservando" } });
    if (reserva.count === 0) continue;
    try {
      const k = await criarCartao({ entregaId: entrega.id, titulo: c.descricao, pilar: c.pilar ?? "COMERCIAL", dataAlvo: c.prazoEm, cliente: c.responsavel === "CLIENTE", responsavelId: dono, descricao: c.evidencia ? `Combinado: "${c.evidencia}"` : null });
      await prisma.combinado.update({ where: { id: c.id }, data: { cartaoId: k.id } });
      n++;
    } catch (e) {
      await prisma.combinado.update({ where: { id: c.id }, data: { cartaoId: null } });
      throw e;
    }
  }
  return n;
}

/** Cartão concluído (ou reaberto) no quadro da entrega: o combinado ligado acompanha. */
export async function sincronizarComCartao(cartaoId: string, concluido: boolean, agora: Date = new Date()) {
  if (concluido) await prisma.combinado.updateMany({ where: { cartaoId, status: "PENDENTE" }, data: { status: "ENTREGUE", entregueEm: agora } });
  else await prisma.combinado.updateMany({ where: { cartaoId, status: "ENTREGUE" }, data: { status: "PENDENTE", entregueEm: null } });
}
