import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// GET /api/pedidos/nacionais?etapa=AGUARDANDO_PAGAMENTO
export async function GET(req: NextRequest) {
  const etapa = req.nextUrl.searchParams.get('etapa');

  const pedidos = await prisma.pedidoNacional.findMany({
    where: etapa ? { etapaEnvio: etapa } : undefined,
    orderBy: { criadoEm: 'desc' },
  });

  return NextResponse.json({ pedidos });
}
