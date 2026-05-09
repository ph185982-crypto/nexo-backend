import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarPix, criarLinkParcelado } from '@/lib/pagamento/mercado-pago';
import { sendPushToAll } from '@/lib/push/notificar';

// POST /api/pedidos/nacional
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      telefoneCliente,
      nomeCliente,
      produto,
      cepDestino,
      enderecoCompleto,
      valorProduto,
      servicoFreteId,
      transportadora,
      prazoFrete,
      valorFrete,
      formaPagamento,
      conversationId,
    } = body;

    if (!telefoneCliente || !nomeCliente || !produto || !cepDestino || !enderecoCompleto ||
        valorProduto == null || !servicoFreteId || !transportadora || prazoFrete == null ||
        valorFrete == null || !formaPagamento) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const valorTotal = Number(valorProduto) + Number(valorFrete);

    const pedido = await prisma.pedidoNacional.create({
      data: {
        conversationId: conversationId ?? null,
        telefoneCliente,
        nomeCliente,
        produto,
        cepDestino,
        enderecoCompleto,
        valorProduto: Number(valorProduto),
        valorFrete: Number(valorFrete),
        valorTotal,
        transportadora,
        prazoFrete: Number(prazoFrete),
        servicoFreteId,
        formaPagamento,
      },
    });

    let resposta: Record<string, unknown> = { pedidoId: pedido.id };

    if (formaPagamento === 'pix') {
      const pix = await criarPix({
        pedidoId: pedido.id,
        valor: valorTotal,
        descricao: `${produto} — Nexo Brasil`,
        nomeCliente,
      });

      await prisma.pedidoNacional.update({
        where: { id: pedido.id },
        data: { pagamentoId: pix.pagamentoId },
      });

      resposta = { ...resposta, ...pix };
    } else {
      const parcelado = await criarLinkParcelado({
        pedidoId: pedido.id,
        valor: valorTotal,
        descricao: `${produto} — Nexo Brasil`,
        nomeCliente,
      });

      await prisma.pedidoNacional.update({
        where: { id: pedido.id },
        data: { pagamentoId: parcelado.pagamentoId },
      });

      resposta = { ...resposta, ...parcelado };
    }

    await sendPushToAll({
      title: `📦 Novo Pedido Nacional`,
      body: `${nomeCliente} — ${produto} — R$ ${valorTotal.toFixed(2)} (${formaPagamento === 'pix' ? 'Pix' : 'Parcelado'})`,
      url: '/crm/pedidos',
      tag: `pedido-${pedido.id}`,
    });

    return NextResponse.json(resposta, { status: 201 });
  } catch (err: unknown) {
    console.error('[API pedido nacional]', err);
    return NextResponse.json({ error: 'Erro ao criar pedido' }, { status: 500 });
  }
}
