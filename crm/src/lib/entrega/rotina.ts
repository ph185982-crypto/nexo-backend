// Rotina diária do funil de entrega. Regras fixas, sem configurar nada (o que é configurável fica nas automações):
//  1. cartão sem dono herda o responsável da oportunidade (ou o administrador);
//  2. cartão do Backlog com prazo nos próximos 7 dias vai para "Essa semana" — uma vez: se alguém o tirar de lá,
//     a rotina respeita (planejadoEm);
//  3. entrega com todos os cartões concluídos é concluída (pega o que foi concluído antes desta rotina existir);
//  4. 60 dias antes da renovação, abre a oportunidade de renovação no funil de vendas, com tarefa para preparar a proposta.
// Idempotente: rodar duas vezes no mesmo dia não faz nada a mais. Roda no cron diário e em "Executar agora".
import { prisma } from "@/lib/prisma";
import { primeiroAdminAtivo } from "@/lib/auth/admin";
import { criarOportunidade } from "@/lib/funil/mover";
import { criarTarefa } from "@/lib/atividades/tarefas";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { moverCartao } from "./servico";
import { concluirEntrega } from "./ciclo";

const DIA = 86_400_000;
export const DIAS_PLANEJAR = 7;
export const DIAS_ABRIR_RENOVACAO = 60;
/** A proposta de renovação deve estar pronta 30 dias antes; nunca com prazo menor que 3 dias a partir de hoje. */
const DIAS_PROPOSTA_ANTES = 30;
const PRAZO_MINIMO_DIAS = 3;

export interface ResultadoRotina { responsaveis: number; planejados: number; concluidas: number; renovacoes: number; erros: string[] }

const formatarData = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function rodarRotinaDeEntregas(agora: Date = new Date()): Promise<ResultadoRotina> {
  const res: ResultadoRotina = { responsaveis: 0, planejados: 0, concluidas: 0, renovacoes: 0, erros: [] };
  const admin = await primeiroAdminAtivo();
  const entregas = await prisma.entrega.findMany({
    where: { status: { in: ["EM_ANDAMENTO", "CONCLUIDA"] } },
    include: {
      oportunidade: { select: { responsavelId: true } }, contato: { select: { nome: true } },
      cartoes: { select: { id: true, coluna: true, dataAlvo: true, planejadoEm: true } },
    },
  });

  for (const e of entregas) {
    // Uma entrega com problema não pode impedir as outras.
    try {
      const dono = e.oportunidade.responsavelId ?? admin?.id ?? null;
      if (e.status === "EM_ANDAMENTO") {
        if (dono) {
          const r = await prisma.entregaCartao.updateMany({ where: { entregaId: e.id, responsavelId: null, coluna: { not: "CONCLUIDO" } }, data: { responsavelId: dono } });
          res.responsaveis += r.count;
        }
        const limite = agora.getTime() + DIAS_PLANEJAR * DIA;
        for (const c of e.cartoes) {
          if (c.coluna !== "BACKLOG" || c.planejadoEm || !c.dataAlvo || c.dataAlvo.getTime() > limite) continue;
          await moverCartao(c.id, "ESSA_SEMANA", undefined, agora);
          res.planejados++;
        }
        if (e.cartoes.length > 0 && e.cartoes.every((c) => c.coluna === "CONCLUIDO") && (await concluirEntrega(e.id, agora))) res.concluidas++;
      }
      if (e.renovacaoEm && !e.renovacaoOportunidadeId && e.renovacaoEm.getTime() - agora.getTime() <= DIAS_ABRIR_RENOVACAO * DIA) {
        if (await abrirRenovacao(e, dono, agora)) res.renovacoes++;
      }
    } catch (err) {
      res.erros.push(`${e.nome}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
  return res;
}

async function abrirRenovacao(
  e: { id: string; nome: string; contatoId: string; renovacaoEm: Date | null; valorMensal: { toString(): string }; contato: { nome: string } },
  dono: string | null, agora: Date,
): Promise<boolean> {
  // Reserva antes de criar: duas rotinas ao mesmo tempo não abrem duas renovações.
  const reserva = `reservando:${agora.getTime()}`;
  const r = await prisma.entrega.updateMany({ where: { id: e.id, renovacaoOportunidadeId: null }, data: { renovacaoOportunidadeId: reserva } });
  if (r.count === 0) return false;
  try {
    const renovaEm = e.renovacaoEm!;
    const op = await criarOportunidade({
      nome: `Renovação — ${e.nome}`, contatoId: e.contatoId, responsavelId: dono, valorMensal: Number(e.valorMensal.toString()),
      origem: "Renovação", tags: ["renovacao"], finalizaEm: renovaEm, ator: "rotina-entrega",
    });
    const prazo = new Date(Math.max(renovaEm.getTime() - DIAS_PROPOSTA_ANTES * DIA, agora.getTime() + PRAZO_MINIMO_DIAS * DIA));
    await criarTarefa({ titulo: `Preparar a proposta de renovação de ${e.contato.nome}`, tipo: "TAREFA", prioridade: "ALTA", prazoEm: prazo, oportunidadeId: op.id, responsavelId: dono, origem: "AUTOMACAO" });
    await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: `Aberta pela rotina da entrega: o contrato renova em ${formatarData(renovaEm)}.`, autor: "automacao", autorNome: "Rotina da entrega" });
    await prisma.entrega.update({ where: { id: e.id }, data: { renovacaoOportunidadeId: op.id } });
    return true;
  } catch (err) {
    await prisma.entrega.updateMany({ where: { id: e.id, renovacaoOportunidadeId: reserva }, data: { renovacaoOportunidadeId: null } });
    throw err;
  }
}
