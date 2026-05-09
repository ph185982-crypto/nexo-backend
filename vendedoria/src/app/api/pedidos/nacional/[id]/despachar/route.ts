import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { buscarRastreamento } from '@/lib/envio/melhor-envio';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send';

// PUT /api/pedidos/nacional/:id/despachar
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pedido = await prisma.pedidoNacional.findUnique({ where: { id } });
  if (!pedido) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }

  if (!pedido.cartItemId) {
    return NextResponse.json({ error: 'Etiqueta ainda não gerada' }, { status: 400 });
  }

  let codigoRastreamento: string | null = null;

  try {
    codigoRastreamento = await buscarRastreamento(pedido.cartItemId);
  } catch (err) {
    console.error('[despachar] Erro ao buscar rastreamento:', err);
  }

  await prisma.pedidoNacional.update({
    where: { id },
    data: {
      codigoRastreamento,
      etapaEnvio: 'DESPACHADO',
    },
  });

  const config = await prisma.whatsappProviderConfig.findFirst();

  if (config) {
    const msgRastreio = codigoRastreamento
      ? `📦 Seu pedido foi despachado!\n\n🚚 ${pedido.transportadora}\n🔍 Código de rastreamento: *${codigoRastreamento}*\n\nPrevisão: ${pedido.prazoFrete} dia(s) útil(is) 🎯`
      : `📦 Seu pedido foi despachado!\n\n🚚 ${pedido.transportadora}\nPrevisão: ${pedido.prazoFrete} dia(s) útil(is) 🎯\n\nAcompanhe pelo site da transportadora 📱`;

    await sendWhatsAppMessage(
      config.businessPhoneNumberId,
      pedido.telefoneCliente,
      msgRastreio,
      config.accessToken ?? undefined,
    );
  }

  return NextResponse.json({ codigoRastreamento });
}
