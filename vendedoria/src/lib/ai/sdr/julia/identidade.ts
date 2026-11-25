// Identidade da SDR no banco, sempre igual ao código (fonte única: ./roteiro.ts). Idempotente: roda na rotina
// horária (/api/health → recuperação) e na 1ª mensagem de cada instância. Só grava o que está diferente.
//  • Agent.displayName "SDR Avanteza" e Agent.systemPrompt = "[SDR]\n" + ROTEIRO_JULIA (o "[SDR]" é o que liga o fluxo da SDR)
//  • AgentConfig.agentName "Júlia", currentPrompt = ROTEIRO_JULIA, follow-up "24,72" × 2
//  • WhatsappProviderConfig.accountName "Avanteza" (o displayPhoneNumber vem da Graph API: ver whatsapp/perfil-avanteza.ts)
import { prisma } from "@/lib/prisma/client";
import { EMPRESA, NOME_AGENTE_CRM, NOME_SDR, ROTEIRO_JULIA } from "./roteiro";

export const FOLLOWUP_HORAS = "24,72";
export const MAX_FOLLOWUPS = 2;
const PROMPT_AGENTE = `[SDR]\n${ROTEIRO_JULIA}`;

let feito = false;

export async function sincronizarIdentidadeJulia(opts: { forcar?: boolean } = {}): Promise<{ agentes: number; config: number; contas: number }> {
  if (feito && !opts.forcar) return { agentes: 0, config: 0, contas: 0 };
  const agentes = await prisma.agent.findMany({ where: { systemPrompt: { startsWith: "[SDR]" } }, select: { id: true, displayName: true, systemPrompt: true, whatsappProviderConfigId: true } });
  let a = 0, c = 0, k = 0;
  for (const ag of agentes) {
    if (ag.displayName !== NOME_AGENTE_CRM || ag.systemPrompt !== PROMPT_AGENTE) {
      await prisma.agent.update({ where: { id: ag.id }, data: { displayName: NOME_AGENTE_CRM, systemPrompt: PROMPT_AGENTE } });
      a++;
    }
    const conta = await prisma.whatsappProviderConfig.findUnique({ where: { id: ag.whatsappProviderConfigId }, select: { accountName: true } });
    if (conta && conta.accountName !== EMPRESA) {
      await prisma.whatsappProviderConfig.update({ where: { id: ag.whatsappProviderConfigId }, data: { accountName: EMPRESA } });
      k++;
    }
  }
  if (agentes.length) {
    const cfgs = await prisma.agentConfig.findMany({ select: { id: true, agentName: true, currentPrompt: true, followUpHours: true, maxFollowUps: true } });
    for (const cfg of cfgs) {
      if (cfg.agentName !== NOME_SDR || cfg.currentPrompt !== ROTEIRO_JULIA || cfg.followUpHours !== FOLLOWUP_HORAS || cfg.maxFollowUps !== MAX_FOLLOWUPS) {
        await prisma.agentConfig.update({ where: { id: cfg.id }, data: { agentName: NOME_SDR, currentPrompt: ROTEIRO_JULIA, followUpHours: FOLLOWUP_HORAS, maxFollowUps: MAX_FOLLOWUPS } });
        c++;
      }
    }
  }
  feito = true;
  if (a || c || k) console.log(`[Júlia] Identidade sincronizada | agentes=${a} config=${c} contas=${k}`);
  return { agentes: a, config: c, contas: k };
}
