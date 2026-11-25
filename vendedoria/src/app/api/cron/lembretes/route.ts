import { NextResponse } from "next/server";
import { enviarLembretesLigacao } from "@/lib/ai/sdr/julia/lembretes";

// Lembretes 1 h antes das ligações marcadas pela Júlia (cron da Vercel, de 10 em 10 min).
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await enviarLembretesLigacao();
  return NextResponse.json({ ok: true, ...r });
}
