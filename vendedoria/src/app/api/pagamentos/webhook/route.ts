import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { consultarStatus } from '@/lib/pagamento/mercado-pago';
import { adicionarAoCarrinho, gerarEtiqueta } from '@/lib/envio/melhor-envio';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send';
import { config as envConfig } from '@/lib/config/env';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'webhook-mercadopago' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[MP WEBHOOK] Recebido:', JSON.stringify(body));

    if (body.type === 'payment' && body.data?.id) {
      await processarPagamento(String(body.data.id));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[MP WEBHOOK] Erro:', err);
    return NextResponse.json({ ok: false }, { status: 200 }); // sempre 200 para o MP
  }
}

async function processarPagamento(paymentId: string) {
  console.log(`[MP WEBHOOK] Processando payment ${paymentId}`);

  const status = await consultarStatus(paymentId);
  console.log(`[MP WEBHOOK] Status: ${status}`);

  if (status !== 'approved') return;

  const pedido = await prisma.pedidoNacional.findFirst({
    where: { pagamentoId: paymentId },
  });

  if (!pedido) {
    console.error(`[MP WEBHOOK] Pedido não encontrado para payment ${paymentId}`);
    return;
  }

  if (pedido.pagamentoConfirmado) {
    console.log(`[MP WEBHOOK] Já confirmado — ignorando`);
    return;
  }

  await prisma.pedidoNacional.update({
    where: { id: pedido.id },
    data: {
      pagamentoConfirmado: true,
      pagamentoConfirmadoEm: new Date(),
      pagamentoStatus: 'APROVADO',
      etapaEnvio: 'PAGO',
    },
  });

  const config = await prisma.whatsappProviderConfig.findFirst();
  if (!config) return;

  await sendWhatsAppMessage(
    config.businessPhoneNumberId,
    pedido.telefoneCliente,
    `✅ Pagamento confirmado!\n\nSeu pedido foi aprovado 🎉\nJá estamos separando pra envio 📦\n\nEm breve você recebe o código de rastreamento. Qualquer dúvida é só chamar 👊`,
    config.accessToken ?? undefined,
  );

  await gerarEtiquetaENotificar(pedido, config);
}

async function gerarEtiquetaENotificar(
  pedido: {
    id: string;
    cepDestino: string;
    nomeCliente: string;
    servicoFreteId: string;
    produto: string;
    valorProduto: number;
    valorTotal: number;
    enderecoCompleto: string;
    transportadora: string;
    prazoFrete: number;
  },
  config: { businessPhoneNumberId: string; accessToken: string | null },
) {
  try {
    const cartItemId = await adicionarAoCarrinho({
      cepDestino: pedido.cepDestino,
      nomeDestinatario: pedido.nomeCliente,
      servicoId: pedido.servicoFreteId,
      produtoNome: pedido.produto,
      valorProduto: pedido.valorProduto,
    });

    const urlEtiqueta = await gerarEtiqueta(cartItemId);

    await prisma.pedidoNacional.update({
      where: { id: pedido.id },
      data: { cartItemId, urlEtiqueta, etapaEnvio: 'ETIQUETA_GERADA' },
    });

    await sendWhatsAppMessage(
      config.businessPhoneNumberId,
      envConfig.ownerWhatsapp,
      `🔔 *PEDIDO PAGO — EMBALAR E DESPACHAR*\n\n📦 Produto: ${pedido.produto}\n👤 Cliente: ${pedido.nomeCliente}\n📍 CEP: ${pedido.cepDestino}\n📮 Endereço: ${pedido.enderecoCompleto}\n🚚 ${pedido.transportadora} — ${pedido.prazoFrete} dia(s) útil(is)\n💰 Total: R$ ${pedido.valorTotal.toFixed(2)}\n\n🏷️ Etiqueta pronta para imprimir:\n${urlEtiqueta}`,
      config.accessToken ?? undefined,
    );

    console.log(`[ETIQUETA] ✅ Gerada para pedido ${pedido.id}`);
  } catch (err: unknown) {
    console.error(`[ETIQUETA] ❌ Erro para pedido ${pedido.id}:`, (err as Error).message);

    await sendWhatsAppMessage(
      config.businessPhoneNumberId,
      envConfig.ownerWhatsapp,
      `⚠️ *PEDIDO PAGO — GERAR ETIQUETA MANUALMENTE*\n\nPedido: ${pedido.id}\nCliente: ${pedido.nomeCliente}\nCEP: ${pedido.cepDestino}\nProduto: ${pedido.produto}\n\nErro ao gerar etiqueta automática. Acesse o Melhor Envio manualmente.`,
      config.accessToken ?? undefined,
    );
  }
}
