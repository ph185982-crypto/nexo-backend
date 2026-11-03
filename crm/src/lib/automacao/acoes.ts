import { prisma } from "@/lib/prisma";
import { moverOportunidade } from "@/lib/funil/mover";
import { criarTarefa } from "@/lib/atividades/tarefas";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { codigoOportunidade } from "@/lib/funil/encerramento";
import type { Acao } from "./modelo";
import { verificarUrlWebhook } from "./url-segura";

export interface OportunidadeParaAcao { id: string; numero: number; criadoEm: Date; nome: string; responsavelId: string | null; tags: string[]; valorUnico: { toString(): string }; valorMensal: { toString(): string }; contato: { id: string; nome: string }; etapa: { nome: string; funil: { nome: string } } }

/** Executa uma ação e devolve o que ficou registrado. Lança em erro (a execução vira ERRO). */
export async function executarAcao(acao: Acao, op: OportunidadeParaAcao, automacao: { id: string; nome: string }, gatilho: string, agora: Date = new Date()): Promise<string> {
  switch (acao.tipo) {
    case "CRIAR_TAREFA": {
      const t = await criarTarefa({ titulo: acao.titulo, prioridade: acao.prioridade, tipo: acao.tipoTarefa, prazoEm: new Date(agora.getTime() + acao.prazoHoras * 3_600_000), oportunidadeId: op.id, responsavelId: op.responsavelId, origem: "AUTOMACAO" });
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
      await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: acao.mensagem, importante: true, autor: "automacao", autorNome: automacao.nome });
      return "Alerta registrado";
    }
    case "DISPARAR_WEBHOOK": {
      await verificarUrlWebhook(acao.url);
      const r = await fetch(acao.url, {
        method: "POST", headers: { "content-type": "application/json", "user-agent": "avanteza-crm" }, redirect: "manual", signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          automacao: { id: automacao.id, nome: automacao.nome }, gatilho,
          oportunidade: { id: op.id, codigo: codigoOportunidade(op.numero, op.criadoEm), nome: op.nome, etapa: op.etapa.nome, funil: op.etapa.funil.nome, valorTotal: Number(op.valorUnico.toString()) + Number(op.valorMensal.toString()), tags: op.tags, contato: op.contato },
        }),
      });
      if (!r.ok) throw new Error(`Webhook respondeu HTTP ${r.status}`);
      return `Webhook respondeu HTTP ${r.status}`;
    }
  }
}
