import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send';

// PUT /api/pedidos/nacional/:id/despachar
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { codigoRastreamento?: string };
  const codigoRastreamento: string | null = body.codigoRastreamento?.trim() || null;

  const pedido = await prisma.pedidoNacional.findUnique({ where: { id } });
  if (!pedido) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }

  await prisma.pedidoNacional.update({
    where: { id },
    data: {
      codigoRastreamento,
      etapaEnvio: 'ENVIADO',
    },
  });

  const config = await prisma.whatsappProviderConfig.findFirst();

  if (config) {
    const msgRastreio = codigoRastreamento
      ? `📦 Seu pedido foi enviado!\n\n🔍 Código de rastreamento: *${codigoRastreamento}*\n\nAcompanhe em: correios.com.br\n\nQualquer dúvida é só chamar 👊`
      : `📦 Seu pedido foi enviado!\n\nAssim que tivermos o código de rastreamento, te avisamos aqui 😊\n\nQualquer dúvida é só chamar 👊`;

    await sendWhatsAppMessage(
      config.businessPhoneNumberId,
      pedido.telefoneCliente,
      msgRastreio,
      config.accessToken ?? undefined,
    );
  }

  return NextResponse.json({ ok: true, codigoRastreamento });
}
