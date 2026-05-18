import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// POST /api/checkout — cria checkout com 24h de validade
// body: { telefoneCliente, conversationId? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { conversationId, telefoneCliente } = body as {
      conversationId?: string;
      telefoneCliente: string;
    };

    if (!telefoneCliente) {
      return NextResponse.json({ error: 'telefoneCliente obrigatório' }, { status: 400 });
    }

    const expiradoEm = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const checkout = await prisma.checkout.create({
      data: {
        telefoneCliente,
        conversationId: conversationId ?? null,
        expiradoEm,
      },
    });

    const baseUrl =
      process.env.RENDER_EXTERNAL_URL ??
      process.env.NEXTAUTH_URL ??
      'http://localhost:3000';

    const url = `${baseUrl}/checkout/${checkout.id}`;

    return NextResponse.json({ id: checkout.id, url }, { status: 201 });
  } catch (err) {
    console.error('[API checkout POST]', err);
    return NextResponse.json({ error: 'Erro ao criar checkout' }, { status: 500 });
  }
}
