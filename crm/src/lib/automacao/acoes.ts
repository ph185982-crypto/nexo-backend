import { prisma } from "@/lib/prisma";
import { moverOportunidade } from "@/lib/funil/mover";
import { criarTarefa } from "@/lib/atividades/tarefas";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { codigoOportunidade } from "@/lib/funil/encerramento";
import type { Acao } from "./modelo";
import { enviarWebhook, verificarUrlWebhook } from "./url-segura";
import { primeiroAdminAtivo } from "@/lib/auth/admin";

export interface OportunidadeParaAcao { id: string; numero: number; criadoEm: Date; nome: string; responsavelId: string | null; tags: string[]; valorUnico: { toString(): string }; valorMensal: { toString(): string }; contato: { id: string; nome: string }; etapa: { nome: string; funil: { nome: string } } }

/** O que um gatilho de entrega sabe além da oportunidade: a entrega, o cartão e quantos dias (de atraso, de espera…). */
export interface ContextoDaAcao {
  entrega?: { id: string; nome: string };
  cartao?: { id: string; titulo: string; responsavelId: string | null };
  dias?: number;
}

/** Troca {cliente}, {oportunidade}, {entrega}, {cartao} e {dias}. Marca sem valor neste gatilho fica como está. */
export function preencherTexto(t: string, op: Pick<OportunidadeParaAcao, "nome" | "contato">, ctx: ContextoDaAcao = {}): string {
  const valores: Record<string, string | undefined> = {
    cliente: op.contato.nome, oportunidade: op.nome, entrega: ctx.entrega?.nome, cartao: ctx.cartao?.titulo, dias: ctx.dias === undefined ? undefined : String(ctx.dias),
  };
  return t.replace(/\{(cliente|oportunidade|entrega|cartao|dias)\}/g, (marca, k: string) => valores[k] ?? marca);
}

/** Executa uma ação e devolve o que ficou registrado. Lança em erro (a execução vira ERRO). */
export async function executarAcao(acao: Acao, op: OportunidadeParaAcao, automacao: { id: string; nome: string }, gatilho: string, agora: Date = new Date(), ctx: ContextoDaAcao = {}): Promise<string> {
  switch (acao.tipo) {
    case "CRIAR_TAREFA": {
      // Quem cuida do cartão recebe a tarefa; senão o dono da oportunidade; senão o administrador (Vendedor IA,
      // importação). Sem dono ela sumiria das visões "Minhas" e ninguém a veria.
      const responsavelId = ctx.cartao?.responsavelId ?? op.responsavelId ?? (await primeiroAdminAtivo())?.id ?? null;
      const t = await criarTarefa({ titulo: preencherTexto(acao.titulo, op, ctx).slice(0, 200), prioridade: acao.prioridade, tipo: acao.tipoTarefa, prazoEm: new Date(agora.getTime() + acao.prazoHoras * 3_600_000), oportunidadeId: op.id, responsavelId, origem: "AUTOMACAO" });
      return `Tarefa criada (${t.id})`;
    }
    case "MOVER_ETAPA": {
      // origem AUTOMACAO: o motor não dispara automações a partir dela (sem laço).
      const r = await moverOportunidade({ oportunidadeId: op.id, etapaId: acao.etapaId, origem: "AUTOMACAO", ator: "automacao", motivo: `Automação: ${automacao.nome}` });
      return r.mudou ? "Etapa alterada" : "Já estava na etapa";
    }
    case "ADICIONAR_TAG": {
      const atual = await prisma.oportunidade.findUnique({ where: { id: op.id }, select: { tags: true } });
      if (!atual) throw new Error("Oportunidade não encontrada");
      if (atual.tags.includes(acao.tag)) return "Tag já existia";
      await prisma.oportunidade.update({ where: { id: op.id }, data: { tags: [...atual.tags, acao.tag] } });
      return `Tag #${acao.tag} adicionada`;
    }
    case "REGISTRAR_ALERTA": {
      await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: preencherTexto(acao.mensagem, op, ctx), importante: true, autor: "automacao", autorNome: automacao.nome });
      return "Alerta registrado";
    }
    case "DISPARAR_WEBHOOK": {
      await verificarUrlWebhook(acao.url);
      const r = await enviarWebhook(acao.url, JSON.stringify({
        automacao: { id: automacao.id, nome: automacao.nome }, gatilho,
        oportunidade: { id: op.id, codigo: codigoOportunidade(op.numero, op.criadoEm), nome: op.nome, etapa: op.etapa.nome, funil: op.etapa.funil.nome, valorTotal: Number(op.valorUnico.toString()) + Number(op.valorMensal.toString()), tags: op.tags, contato: op.contato },
        ...(ctx.entrega && { entrega: ctx.entrega }),
        ...(ctx.cartao && { cartao: { id: ctx.cartao.id, titulo: ctx.cartao.titulo } }),
        ...(ctx.dias !== undefined && { dias: ctx.dias }),
      }));
      if (r.status < 200 || r.status >= 300) throw new Error(`Webhook respondeu HTTP ${r.status}`);
      return `Webhook respondeu HTTP ${r.status}`;
    }
  }
}
