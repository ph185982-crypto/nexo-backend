import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// GET /api/checkout/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const checkout = await prisma.checkout.findUnique({ where: { id } });

  if (!checkout) {
    return NextResponse.json({ erro: 'Checkout não encontrado' }, { status: 404 });
  }

  if (checkout.status === 'PAGO') {
    return NextResponse.json({ pago: true });
  }

  if (checkout.status === 'EXPIRADO' || checkout.expiradoEm < new Date()) {
    if (checkout.status !== 'EXPIRADO') {
      await prisma.checkout.update({ where: { id }, data: { status: 'EXPIRADO' } }).catch(() => {});
    }
    return NextResponse.json({ expirado: true });
  }

  return NextResponse.json({ ok: true, id: checkout.id, status: checkout.status });
}
