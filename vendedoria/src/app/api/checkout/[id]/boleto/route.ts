import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { criarBoleto } from '@/lib/pagamento/mercado-pago';
import { config } from '@/lib/config/env';

// POST /api/checkout/:id/boleto
// body: { nome, cpf, cep, endereco, numero, complemento, cidade, estado }
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
  const { nome, cpf, cep, endereco, numero, complemento, cidade, estado } = body;

  if (!nome?.trim() || !cpf?.trim() || !cep?.trim() || !endereco?.trim() || !cidade?.trim()) {
    return NextResponse.json({ erro: 'Dados obrigatórios: nome, cpf, cep, endereco, cidade' }, { status: 400 });
  }

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return NextResponse.json({ erro: 'CPF inválido' }, { status: 400 });
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
      formaPagamento: 'boleto',
    },
  });

  const descricao = `${checkout.produto ?? config.businessName}`;
  const boleto = await criarBoleto({
    pedidoId: checkout.id,
    valor: checkout.valorProduto,
    descricao,
    nomeCliente: nome.trim(),
    cpf: cpfLimpo,
    cep: cep.replace(/\D/g, ''),
    endereco: endereco.trim(),
    numero: numero?.trim() ?? 'S/N',
    cidade: cidade.trim(),
    estado: estado?.trim() ?? 'GO',
  });

  await prisma.checkout.update({
    where: { id },
    data: {
      pagamentoId: boleto.pagamentoId,
      pagamentoTipo: 'boleto',
    },
  });

  return NextResponse.json({
    boletoUrl: boleto.boletoUrl,
    boletoCodigoBarra: boleto.boletoCodigoBarra,
    dataVencimento: boleto.dataVencimento,
  });
}
