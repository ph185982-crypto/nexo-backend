// Limpeza única do Kanban da SDR (roteiro da Júlia, 24/11/2026). Roda UMA vez, e só depois de o dono ver a prévia:
//  1. "Em qualificação" sem mensagem do lead há mais de 7 dias e sem icpStatus QUALIFICADO → "Perdido" (motivo "Sem resposta").
//  2. icpStatus FORA fora de "Fora do ICP" → "Fora do ICP" — só quem também é FORA pela regra nova (sem loja/estoque) e
//     não tem ligação marcada no futuro.
// Prévia: limpezaSdr({ executar: false }). Execução: LIMPEZA_AUTORIZADA = true (+ marca em max_alertas_enviados).
import { prisma } from "@/lib/prisma/client";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { MOTIVO } from "@/lib/crm/motivos";

/** Só vira true depois de o dono aprovar a prévia (resposta no chat de 25/11). */
export const LIMPEZA_AUTORIZADA = false;
const MARCA = "limpeza-sdr-julia-2026-11-v1";

export interface PreviaLimpeza { semResposta: Array<{ id: string; nome: string | null }>; foraDoIcp: Array<{ id: string; nome: string | null; coluna: string }> }

export async function limpezaSdr(opts: { executar?: boolean; agora?: Date } = {}): Promise<PreviaLimpeza & { executada: boolean }> {
  const agora = opts.agora ?? new Date();
  const limite = new Date(agora.getTime() - 7 * 86_400_000);
  const colEmQualif = await prisma.kanbanColumn.findMany({ where: { name: "Em qualificação" }, select: { id: true, organizationId: true } });
  const colFora = await prisma.kanbanColumn.findMany({ where: { name: "Fora do ICP" }, select: { id: true } });

  const candidatos = await prisma.lead.findMany({
    where: { kanbanColumnId: { in: colEmQualif.map((c) => c.id) }, NOT: { icpStatus: "QUALIFICADO" } },
    select: { id: true, profileName: true, icpStatus: true, lojaFisica: true, conversations: { select: { messages: { where: { role: "USER" }, orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } } } } },
  });
  const semResposta = candidatos.filter((l) => {
    if (l.icpStatus === "FORA" && l.lojaFisica === "NAO") return false; // vai para "Fora do ICP" (regra 2)
    const ultima = l.conversations.flatMap((c) => c.messages).map((m) => m.sentAt.getTime()).sort((a, b) => b - a)[0];
    return !ultima || ultima < limite.getTime();
  }).map((l) => ({ id: l.id, nome: l.profileName }));

  const fora = await prisma.lead.findMany({
    where: { icpStatus: "FORA", lojaFisica: "NAO", kanbanColumnId: { notIn: colFora.map((c) => c.id) }, OR: [{ reuniaoEm: null }, { reuniaoEm: { lt: agora } }] },
    select: { id: true, profileName: true, kanbanColumn: { select: { name: true } } },
  });
  const foraDoIcp = fora.map((l) => ({ id: l.id, nome: l.profileName, coluna: l.kanbanColumn.name }));

  if (!opts.executar) return { semResposta, foraDoIcp, executada: false };
  try { await prisma.alertaEnviadoMax.create({ data: { chave: MARCA } }); } catch { return { semResposta, foraDoIcp, executada: false }; }

  const orgDe = new Map((await prisma.lead.findMany({ where: { id: { in: [...semResposta, ...foraDoIcp].map((x) => x.id) } }, select: { id: true, organizationId: true } })).map((l) => [l.id, l.organizationId]));
  for (const l of semResposta) {
    await moverLeadPorTipo(l.id, orgDe.get(l.id)!, "LOST", "Limpeza: sem resposta há mais de 7 dias", undefined, { motivoEncerramento: MOTIVO.SEM_RESPOSTA, ator: "sistema", origem: "PIPELINE" });
  }
  for (const l of foraDoIcp) {
    await moverLeadPorTipo(l.id, orgDe.get(l.id)!, "FORA_ICP", "Limpeza: sem loja e sem estoque próprio", undefined, { motivoEncerramento: MOTIVO.FORA_ICP, ator: "sistema", origem: "PIPELINE" });
  }
  console.log(`[Júlia] Limpeza feita | perdido=${semResposta.length} fora=${foraDoIcp.length}`);
  return { semResposta, foraDoIcp, executada: true };
}
