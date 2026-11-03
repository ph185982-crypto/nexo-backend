// Chamado pelo agendador (Vercel Cron envia Authorization: Bearer $CRON_SECRET). Sem CRON_SECRET configurado, fica desligado.
import { timingSafeEqual } from "node:crypto";
import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";

export const maxDuration = 60;
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
  const varredura = await varrerTempo();
  return Response.json({ varredura, execucao: await processarVencidas() });
}
