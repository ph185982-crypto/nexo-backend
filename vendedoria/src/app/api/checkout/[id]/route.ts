import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// GET /api/checkout/:id — retorna dados do checkout; 410 se expirado
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const checkout = await prisma.checkout.findUnique({ where: { id } });

  if (!checkout) {
    return NextResponse.json({ error: 'Checkout não encontrado' }, { status: 404 });
  }

  if (checkout.status === 'EXPIRADO' || checkout.expiradoEm < new Date()) {
    if (checkout.status !== 'EXPIRADO') {
      await prisma.checkout.update({ where: { id }, data: { status: 'EXPIRADO' } });
    }
    return NextResponse.json({ error: 'Checkout expirado' }, { status: 410 });
  }

  return NextResponse.json(checkout);
}
