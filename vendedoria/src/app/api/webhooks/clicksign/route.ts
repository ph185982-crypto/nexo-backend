// Webhook da ClickSign: público (sob /api/webhooks/), protegido pelo HMAC do corpo (Content-Hmac: sha256=…) com
// CLICKSIGN_WEBHOOK_SECRET. Sem o segredo: 503. Lógica em lib/comercial/contratos/webhook.ts.
import { processarWebhookClickSign } from "@/lib/comercial/contratos/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const corpo = await req.text();
  try {
    const r = await processarWebhookClickSign(corpo, req.headers);
    return Response.json(r.corpo, { status: r.status });
  } catch (e) {
    console.error("[clicksign] webhook falhou:", e);
    return Response.json({ erro: "Erro interno" }, { status: 500 }); // a ClickSign reenvia
  }
}
