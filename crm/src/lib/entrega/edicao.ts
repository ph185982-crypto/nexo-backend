// Edição de entrega e de cartão: validação + gravação num só lugar, usada pela tela do CRM (/api/entregas/…)
// e pela API de serviço da Central (/api/integracoes/avanteza/entregas/…). Nenhuma regra fica duplicada nas rotas.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarChecklist } from "@/lib/atividades/tarefas";
import { ErroEntrada, dataOpc, escolha, texto, textoOpc } from "@/lib/validar";
import { COLUNAS, PILARES, STATUS_ENTREGA, type Coluna } from "./constantes";
import { criarCartao, moverCartao, type NovoCartao } from "./servico";

type Corpo = Record<string, unknown>;

/** Valida o corpo de "novo cartão". Lança ErroEntrada (→ 400). */
export async function validarNovoCartao(entregaId: string, c: Corpo): Promise<NovoCartao> {
  return {
    entregaId, titulo: texto(c.titulo, "Título", { min: 1, max: 200 }), descricao: textoOpc(c.descricao, "Descrição", 5000),
    pilar: escolha(c.pilar, "pilar", PILARES, "COMERCIAL"), coluna: escolha<Coluna>(c.coluna, "coluna", COLUNAS, "BACKLOG"),
    dataAlvo: dataOpc(c.dataAlvo, "Data alvo"), cliente: c.cliente === true, checklist: c.checklist,
    responsavelId: await responsavelOpc(c.responsavelId),
  };
}

/** Responsável do cartão: precisa ser um usuário ativo. `null`/"" tira o responsável. */
async function responsavelOpc(v: unknown): Promise<string | null> {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ErroEntrada("Responsável inválido");
  const u = await prisma.usuario.findFirst({ where: { id: v, ativo: true }, select: { id: true } });
  if (!u) throw new ErroEntrada("Responsável inválido");
  return u.id;
}

/** Cria o cartão; devolve null se a entrega não existe. */
export async function criarCartaoValidado(entregaId: string, c: Corpo): Promise<{ id: string } | null> {
  if (!(await prisma.entrega.findUnique({ where: { id: entregaId }, select: { id: true } }))) return null;
  const cartao = await criarCartao(await validarNovoCartao(entregaId, c));
  return { id: cartao.id };
}

/** Edita (e/ou move) um cartão. Devolve false se o cartão não é desta entrega. */
export async function atualizarCartao(entregaId: string, cartaoId: string, c: Corpo): Promise<boolean> {
  const atual = await prisma.entregaCartao.findFirst({ where: { id: cartaoId, entregaId }, select: { id: true } });
  if (!atual) return false;
  // Valida tudo antes de gravar qualquer coisa.
  const coluna = c.coluna !== undefined ? escolha<Coluna>(c.coluna, "coluna", COLUNAS) : undefined;
  const posicao = c.posicao === undefined ? undefined : Number(c.posicao);
  if (posicao !== undefined && (!Number.isInteger(posicao) || posicao < 0 || posicao > 1000)) throw new ErroEntrada("posicao inválida");
  const dados: Prisma.EntregaCartaoUncheckedUpdateInput = {
    ...(c.titulo !== undefined && { titulo: texto(c.titulo, "Título", { min: 1, max: 200 }) }),
    ...(c.descricao !== undefined && { descricao: textoOpc(c.descricao, "Descrição", 5000) }),
    ...(c.pilar !== undefined && { pilar: escolha(c.pilar, "pilar", PILARES) }),
    ...(c.dataAlvo !== undefined && { dataAlvo: dataOpc(c.dataAlvo, "Data alvo") }),
    ...(c.checklist !== undefined && { checklist: normalizarChecklist(c.checklist) as unknown as Prisma.InputJsonValue }),
    ...(c.cliente !== undefined && { cliente: c.cliente === true }),
    ...(c.responsavelId !== undefined && { responsavelId: await responsavelOpc(c.responsavelId) }),
  };
  if (coluna) await moverCartao(cartaoId, coluna, posicao);
  if (Object.keys(dados).length) await prisma.entregaCartao.update({ where: { id: cartaoId }, data: dados });
  return true;
}

/** Edita a entrega (status, renovação, fim previsto, diagnóstico por pilar). Devolve false se não existe. */
export async function atualizarEntrega(id: string, c: Corpo): Promise<boolean> {
  const atual = await prisma.entrega.findUnique({ where: { id }, select: { diagnostico: true, status: true } });
  if (!atual) return false;
  let diagnostico: Prisma.InputJsonValue | undefined;
  if (c.diagnostico !== undefined) {
    const d = (typeof c.diagnostico === "object" && c.diagnostico !== null ? c.diagnostico : {}) as Record<string, unknown>;
    const merged = { ...(atual.diagnostico as Record<string, string>) };
    for (const [k, v] of Object.entries(d)) {
      if (!(PILARES as readonly string[]).includes(k)) continue;
      merged[k] = texto(v ?? "", `Diagnóstico ${k}`, { max: 5000 });
    }
    diagnostico = merged;
  }
  const status = c.status !== undefined ? escolha(c.status, "status", STATUS_ENTREGA) : undefined;
  const renovacaoEm = c.renovacaoEm !== undefined ? dataOpc(c.renovacaoEm, "Renovação") : undefined;
  const fimPrevistoEm = c.fimPrevistoEm !== undefined ? dataOpc(c.fimPrevistoEm, "Fim previsto") : undefined;
  await prisma.entrega.update({
    where: { id },
    data: {
      // Concluir à mão: grava quando e (logo abaixo) dispara "Entrega concluída". Sair de concluída zera a data.
      ...(status !== undefined && status !== atual.status && { status, concluidaEm: status === "CONCLUIDA" ? new Date() : null }),
      ...(renovacaoEm !== undefined && { renovacaoEm }),
      ...(fimPrevistoEm !== undefined && { fimPrevistoEm }),
      ...(diagnostico !== undefined && { diagnostico }),
    },
  });
  if (status === "CONCLUIDA" && atual.status !== "CONCLUIDA") {
    const { dispararEventoEntrega } = await import("@/lib/automacao/motor");
    await dispararEventoEntrega("ENTREGA_CONCLUIDA", id, null);
  }
  return true;
}
