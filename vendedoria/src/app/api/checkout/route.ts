import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';

// POST /api/checkout — cria checkout com 24h de validade
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const {
      conversationId,
      telefoneCliente,
      nomeCliente,
      produto,
      valorProduto,
      cep,
      enderecoCompleto,
    } = body as {
      conversationId: string;
      telefoneCliente: string;
      nomeCliente: string;
      produto: string;
      valorProduto: number;
      cep: string;
      enderecoCompleto: string;
    };

    if (!conversationId || !telefoneCliente || !nomeCliente || !produto || !valorProduto || !cep || !enderecoCompleto) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const expiradoEm = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const checkout = await prisma.checkout.create({
      data: {
        conversationId,
        telefoneCliente,
        nomeCliente,
        produto,
        valorProduto,
        cep,
        enderecoCompleto,
        expiradoEm,
      },
    });

    const baseUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
    const url = `${baseUrl}/checkout/${checkout.id}`;

    return NextResponse.json({ id: checkout.id, url }, { status: 201 });
  } catch (err) {
    console.error('[API checkout POST]', err);
    return NextResponse.json({ error: 'Erro ao criar checkout' }, { status: 500 });
  }
}
