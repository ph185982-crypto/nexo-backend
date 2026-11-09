// Chamado pelo agendador (Vercel Cron envia Authorization: Bearer $CRON_SECRET). Sem CRON_SECRET configurado, fica desligado.
import { timingSafeEqual } from "node:crypto";
import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { rodarRotinaDeEntregas } from "@/lib/entrega/rotina";
import { processarPendentes } from "@/lib/combinados/fontes";
import { sincronizarTodas } from "@/lib/google/reunioes";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function segredoValido(req: Request, segredo: string): boolean {
  const recebido = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(recebido), b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || segredo.length < 16) return Response.json({ erro: "CRON_SECRET não configurado" }, { status: 503 });
  if (!segredoValido(req, segredo)) return Response.json({ erro: "Não autorizado" }, { status: 401 });
  // A rotina vem antes: o que ela muda (dono do cartão, "Essa semana") já vale para as automações.
  const entregas = await rodarRotinaDeEntregas();
  const varredura = await varrerTempo();
  const execucao = await processarVencidas();
  // Agente de combinados: o que ficou na fila (análise que não rodou depois da resposta).
  // Reuniões do Meet primeiro: as transcrições novas entram na fila do agente desta mesma rodada.
  const google = await sincronizarTodas().catch(() => ({ contas: 0, vinculadas: 0, erros: 1 }));
  const agente = await processarPendentes(5);
  return Response.json({ entregas, varredura, execucao, google, agente });
}
