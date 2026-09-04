import { prisma } from "@/lib/prisma/client";

// Trava atômica por conversa contra duas execuções de IA respondendo em
// paralelo pro mesmo cliente. O debounce (espera curta + checagem de
// mensagem mais nova) só protege os primeiros ~1-2s: o ciclo completo
// (LLM + "digitando..." + envio de vários balões) pode levar 12-20s, e se o
// cliente mandar outra mensagem nesse meio-tempo, a nova execução faz sua
// PRÓPRIA checagem de debounce, não vê nada mais novo que ela mesma (a
// primeira execução ainda não terminou de gerar/gravar nada) e também segue
// em frente — as duas chamam o LLM e mandam resposta, duplicando a
// mensagem pro cliente. Esta trava serializa: só uma execução por conversa
// chega a chamar o LLM/enviar por vez; quem não consegue a trava espera —
// a execução mais nova é sempre a que efetivamente responde, porque quem
// estava esperando refaz a checagem de debounce assim que a trava libera.
const AI_LOCK_HOLD_MS = 50_000;
const AI_LOCK_MAX_WAIT_MS = 35_000;
const AI_LOCK_POLL_MS = 1_000;

export async function acquireAiLock(conversationId: string): Promise<boolean> {
  const deadline = Date.now() + AI_LOCK_MAX_WAIT_MS;
  for (;;) {
    const now = new Date();
    const claim = await prisma.whatsappConversation.updateMany({
      where: {
        id: conversationId,
        OR: [{ aiLockUntil: null }, { aiLockUntil: { lt: now } }],
      },
      data: { aiLockUntil: new Date(now.getTime() + AI_LOCK_HOLD_MS) },
    });
    if (claim.count > 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, AI_LOCK_POLL_MS));
  }
}

export async function releaseAiLock(conversationId: string): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { aiLockUntil: null },
  }).catch(() => {});
}
