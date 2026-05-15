import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarPix, criarLinkParcelado } from '@/lib/pagamento/mercado-pago';
import { sendPushToAll } from '@/lib/push/notificar';
import { config } from '@/lib/config/env';

// POST /api/pedidos/nacional
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const {
      telefoneCliente,
      nomeCliente,
      produto,
      produtoId,
      cepDestino,
      enderecoCompleto,
      formaPagamento,
      conversationId,
    } = body as {
      telefoneCliente: string;
      nomeCliente: string;
      produto: string;
      produtoId?: string;
      cepDestino: string;
      enderecoCompleto: string;
      formaPagamento: string;
      conversationId?: string;
    };

    if (!telefoneCliente || !nomeCliente || !produto || !cepDestino || !enderecoCompleto || !formaPagamento) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    // Busca preço real no banco — SEMPRE, nunca usa valor do body para cobrar
    const produtoDB = await prisma.produto.findFirst({
      where: {
        OR: [
          ...(produtoId ? [{ id: produtoId }] : []),
          { nome: { contains: produto, mode: 'insensitive' as const } },
        ],
        ativo: true,
      },
    });

    if (!produtoDB) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const valorProdutoReal = produtoDB.precoDesconto ?? produtoDB.precoVenda;
    const valorCobrado = valorProdutoReal; // frete grátis — cliente paga só o produto

    const pedido = await prisma.pedidoNacional.create({
      data: {
        conversationId: (conversationId as string) ?? null,
        telefoneCliente,
        nomeCliente,
        produto: produtoDB.nome,
        cepDestino,
        enderecoCompleto,
        valorProduto: valorProdutoReal,
        valorFrete: 0,
        valorTotal: valorCobrado,
        transportadora: 'A definir',
        prazoFrete: 0,
        servicoFreteId: 'manual',
        formaPagamento,
      },
    });

    let resposta: Record<string, unknown> = {
      pedidoId: pedido.id,
      valorTotal: valorCobrado,
      formaPagamento,
      freteGratis: true,
    };

    const descricaoProduto = `${produtoDB.nome} — ${config.businessName}`;

    if (formaPagamento === 'pix') {
      const pix = await criarPix({
        pedidoId: pedido.id,
        valor: valorCobrado,
        descricao: descricaoProduto,
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
        valor: valorCobrado,
        descricao: descricaoProduto,
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
      body: `${nomeCliente} — ${produtoDB.nome} — R$ ${valorCobrado.toFixed(2)} (${formaPagamento === 'pix' ? 'Pix' : 'Parcelado'}) | Frete grátis`,
      url: '/crm/pedidos',
      tag: `pedido-${pedido.id}`,
    });

    return NextResponse.json(resposta, { status: 201 });
  } catch (err: unknown) {
    console.error('[API pedido nacional]', err);
    return NextResponse.json({ error: 'Erro ao criar pedido' }, { status: 500 });
  }
}
