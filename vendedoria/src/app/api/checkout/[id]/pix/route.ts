import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarPix } from '@/lib/pagamento/mercado-pago';
import { config } from '@/lib/config/env';

// POST /api/checkout/:id/pix — gera Pix real via MP SDK (idempotente)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const checkout = await prisma.checkout.findUnique({ where: { id } });

  if (!checkout) {
    return NextResponse.json({ error: 'Checkout não encontrado' }, { status: 404 });
  }

  if (checkout.status === 'EXPIRADO' || checkout.expiradoEm < new Date()) {
    return NextResponse.json({ error: 'Checkout expirado' }, { status: 410 });
  }

  if (checkout.status === 'PAGO') {
    return NextResponse.json({ error: 'Checkout já pago' }, { status: 409 });
  }

  // Idempotente: retorna Pix já gerado se existir
  if (checkout.pixCopiaECola && checkout.pagamentoTipo === 'pix') {
    return NextResponse.json({
      pixCopiaECola: checkout.pixCopiaECola,
      qrCodeBase64: checkout.pixQrCodeBase64,
      pagamentoId: checkout.pagamentoId,
      valor: checkout.valorProduto,
    });
  }

  const descricao = `${checkout.produto} — ${config.businessName}`;

  const pix = await criarPix({
    pedidoId: checkout.id,
    valor: checkout.valorProduto,
    descricao,
    nomeCliente: checkout.nomeCliente,
  });

  await prisma.checkout.update({
    where: { id },
    data: {
      pagamentoId: pix.pagamentoId,
      pagamentoTipo: 'pix',
      pixCopiaECola: pix.pixCopiaECola,
      pixQrCodeBase64: pix.qrCodeBase64,
    },
  });

  return NextResponse.json({
    pixCopiaECola: pix.pixCopiaECola,
    qrCodeBase64: pix.qrCodeBase64,
    pagamentoId: pix.pagamentoId,
    valor: pix.valor,
  });
}
