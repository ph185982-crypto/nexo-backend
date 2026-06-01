import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarLinkParcelado } from '@/lib/pagamento/mercado-pago';
import { config } from '@/lib/config/env';

// POST /api/checkout/:id/parcelado
// body: { nome, cep, endereco, numero, complemento, cidade, estado }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const checkout = await prisma.checkout.findUnique({ where: { id } });
  if (!checkout) return NextResponse.json({ erro: 'Checkout não encontrado' }, { status: 404 });
  if (checkout.status === 'EXPIRADO' || checkout.expiradoEm < new Date())
    return NextResponse.json({ erro: 'Checkout expirado' }, { status: 410 });
  if (checkout.status === 'PAGO')
    return NextResponse.json({ erro: 'Checkout já pago' }, { status: 409 });

  const body = await req.json() as Record<string, string>;
  const { nome, cep, endereco, numero, complemento, cidade, estado } = body;

  if (!nome?.trim() || !cep?.trim() || !endereco?.trim() || !cidade?.trim()) {
    return NextResponse.json({ erro: 'Dados obrigatórios: nome, cep, endereco, cidade' }, { status: 400 });
  }

  // Idempotente: retorna link já gerado se existir
  if (checkout.linkParcelado && checkout.pagamentoTipo === 'parcelado') {
    return NextResponse.json({ linkPagamento: checkout.linkParcelado });
  }

  // Salva dados do formulário
  await prisma.checkout.update({
    where: { id },
    data: {
      nomeCliente: nome.trim(),
      cep: cep.trim(),
      enderecoCompleto: endereco.trim(),
      numero: numero?.trim() ?? null,
      complemento: complemento?.trim() ?? null,
      cidade: cidade.trim(),
      estado: estado?.trim() ?? null,
      formaPagamento: 'parcelado',
    },
  });

  const descricao = `${checkout.produto ?? config.businessName}`;
  const parcelado = await criarLinkParcelado({
    pedidoId: checkout.id,
    valor: checkout.valorProduto,
    descricao,
    nomeCliente: nome.trim(),
  });

  await prisma.checkout.update({
    where: { id },
    data: {
      pagamentoId: parcelado.pagamentoId,
      pagamentoTipo: 'parcelado',
      linkParcelado: parcelado.linkPagamento,
    },
  });

  return NextResponse.json({ linkPagamento: parcelado.linkPagamento });
}
