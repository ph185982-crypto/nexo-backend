import { NextRequest, NextResponse } from "next/server";
import { notificarNovaMensagem } from "@/lib/push/notificar";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { title, body, url, nomeCliente, preview, conversationId } = await req.json() as {
      title?: string;
      body?: string;
      url?: string;
      nomeCliente?: string;
      preview?: string;
      conversationId?: string;
    };

    if (nomeCliente && conversationId) {
      await notificarNovaMensagem(nomeCliente, preview ?? body ?? "Nova mensagem", conversationId);
    } else if (title && body) {
      const { sendPushToAll } = await import("@/lib/push/notificar");
      await sendPushToAll({ title, body, url: url ?? "/crm/conversations" });
    } else {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
