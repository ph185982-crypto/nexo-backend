// Gatilho oportunista dos follow-ups: qualquer requisição que passe por aqui
// (health da rotina de hora em hora, telas do CRM abertas, webhook) dispara o
// processamento em segundo plano quando há toque vencido. Sem CRON_SECRET,
// sem GitHub, sem plano pago. Throttle de 60s por instância para a contagem
// não pesar no polling das telas.
import { after } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { processarFollowupsVencidos } from "./processar";

const INTERVALO_MIN_MS = 60_000;
let ultimaVerificacao = 0;

export type ResultadoGatilho = "acionado" | "nada" | "throttle";

export async function acionarFollowupsSePreciso(origem: string, opts: { orcamentoMs?: number; forcar?: boolean } = {}): Promise<ResultadoGatilho> {
  const agora = Date.now();
  if (!opts.forcar && agora - ultimaVerificacao < INTERVALO_MIN_MS) return "throttle";
  ultimaVerificacao = agora;

  const vencidos = await prisma.conversationFollowUp
    .count({ where: { status: "ACTIVE", nextSendAt: { lte: new Date() } } })
    .catch(() => 0);
  if (vencidos === 0) return "nada";

  const trabalho = async () => {
    try {
      const r = await processarFollowupsVencidos({ orcamentoMs: opts.orcamentoMs ?? 25_000 });
      console.log(`[FollowUp] gatilho=${origem} vencidos=${vencidos} enviados=${r.sent} encerrados=${r.closed} erros=${r.errors}`);
    } catch (e) {
      console.error(`[FollowUp] gatilho=${origem} falhou:`, e);
    }
  };
  try {
    after(trabalho); // fora do caminho da resposta
  } catch {
    await trabalho(); // sem escopo de requisição (testes/scripts): roda na hora
  }
  return "acionado";
}

/** Só para testes: zera o throttle. */
export function _resetGatilho(): void { ultimaVerificacao = 0; }
