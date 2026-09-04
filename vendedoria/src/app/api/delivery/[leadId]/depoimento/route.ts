import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

// Pedido de depoimento é sempre um clique manual do Pedro no Funil de Entrega —
// nunca automático. Mandar mensagem pedindo depoimento pra cliente real sem um
// humano decidindo o momento certo é o tipo de coisa que pode soar deslocado
// (cliente insatisfeito, projeto recém-começado) — então essa rota só existe
// pra registrar e disparar uma ação que o Pedro escolheu fazer agora.
const MARKER = "📣 Pedido de depoimento enviado ao cliente via WhatsApp";

type Params = { params: Promise<{ leadId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const last = await prisma.leadActivity.findFirst({
    where: { leadId, description: MARKER },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return NextResponse.json({ askedAt: last?.createdAt ?? null });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, phoneNumber: true, profileName: true, organizationId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const provider = await prisma.whatsappProviderConfig.findFirst({
    where: { organizationId: lead.organizationId },
  });
  if (!provider) {
    return NextResponse.json({ error: "Nenhuma conta WhatsApp configurada para esta organização" }, { status: 400 });
  }

  const primeiroNome = (lead.profileName ?? "").trim().split(/\s+/)[0] || null;
  const texto = [
    primeiroNome ? `Oi ${primeiroNome}! Aqui é o Pedro, da Nexo 👋` : "Oi! Aqui é o Pedro, da Nexo 👋",
    "Queria te pedir um favor rápido: você toparia gravar um depoimento curto — texto, áudio ou vídeo, do jeito que for mais fácil pra você — contando como foi a experiência com a gente até aqui?",
    "Isso ajuda muito a mostrar resultado real pra outras empresas que estão avaliando entrar no marketplace. Sem compromisso nenhum se não rolar 🙏",
  ].join("\n\n");

  try {
    await sendWhatsAppMessage(provider.businessPhoneNumberId, lead.phoneNumber, texto, provider.accessToken ?? undefined);
  } catch (e) {
    return NextResponse.json(
      { error: `Falha ao enviar via WhatsApp: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const conversation = await prisma.whatsappConversation.findFirst({ where: { leadId } });
  if (conversation) {
    await prisma.whatsappMessage.create({
      data: { content: texto, type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId: conversation.id },
    }).catch(() => {});
  }

  const activity = await prisma.leadActivity.create({
    data: { leadId, type: "NOTE", description: MARKER, createdBy: session.user.email ?? "PEDRO" },
  });

  return NextResponse.json({ ok: true, askedAt: activity.createdAt });
}
