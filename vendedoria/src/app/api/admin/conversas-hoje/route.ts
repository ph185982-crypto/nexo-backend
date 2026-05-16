import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// Endpoint temporário — exportar conversas do dia
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret');
  if (secret !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const conversas = await prisma.whatsappConversation.findMany({
    where: {
      OR: [
        { createdAt: { gte: hoje } },
        { lastMessageAt: { gte: hoje } },
      ],
    },
    include: {
      messages: {
        orderBy: { sentAt: 'asc' },
        select: {
          role: true,
          content: true,
          type: true,
          sentAt: true,
        },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  return NextResponse.json({ total: conversas.length, conversas });
}
