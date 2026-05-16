import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarLinkParcelado } from '@/lib/pagamento/mercado-pago';
import { config } from '@/lib/config/env';

// POST /api/checkout/:id/parcelado — gera link parcelado via MP SDK (idempotente)
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

  // Idempotente: retorna link já gerado se existir
  if (checkout.linkParcelado && checkout.pagamentoTipo === 'parcelado') {
    return NextResponse.json({
      linkParcelado: checkout.linkParcelado,
      pagamentoId: checkout.pagamentoId,
      valor: checkout.valorProduto,
    });
  }

  const descricao = `${checkout.produto} — ${config.businessName}`;

  const parcelado = await criarLinkParcelado({
    pedidoId: checkout.id,
    valor: checkout.valorProduto,
    descricao,
    nomeCliente: checkout.nomeCliente,
  });

  await prisma.checkout.update({
    where: { id },
    data: {
      pagamentoId: parcelado.pagamentoId,
      pagamentoTipo: 'parcelado',
      linkParcelado: parcelado.linkPagamento,
    },
  });

  return NextResponse.json({
    linkParcelado: parcelado.linkPagamento,
    pagamentoId: parcelado.pagamentoId,
    valor: parcelado.valor,
  });
}
