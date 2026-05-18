import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma/client';
import { consultarStatus } from '@/lib/pagamento/mercado-pago';
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

  // ── Tenta Checkout primeiro ────────────────────────────────────────────────
  const checkout = await prisma.checkout.findFirst({
    where: { pagamentoId: paymentId },
  });

  if (checkout) {
    if (checkout.status === 'PAGO') {
      console.log(`[MP WEBHOOK] Checkout já confirmado — ignorando`);
      return;
    }

    await prisma.checkout.update({
      where: { id: checkout.id },
      data: { status: 'PAGO' },
    });

    const whatsappConfig = await prisma.whatsappProviderConfig.findFirst();
    if (!whatsappConfig) return;

    await sendWhatsAppMessage(
      whatsappConfig.businessPhoneNumberId,
      checkout.telefoneCliente,
      `✅ Pagamento confirmado!\n\nSeu pedido foi aprovado 🎉\nJá estamos separando pra envio 📦\n\nEm breve você recebe o código de rastreamento. Qualquer dúvida é só chamar 👊`,
      whatsappConfig.accessToken ?? undefined,
    );

    const enderecoFormatado = [
      checkout.enderecoCompleto,
      checkout.numero,
      checkout.complemento,
      checkout.cidade,
      checkout.estado,
      checkout.cep,
    ].filter(Boolean).join(', ');

    const formaPagTipo = checkout.formaPagamento ?? checkout.pagamentoTipo ?? '';
    const formaPagLabel = formaPagTipo === 'pix' ? 'Pix ✅' : formaPagTipo === 'bolbradesco' || formaPagTipo === 'boleto' ? 'Boleto' : 'Cartão parcelado';

    await sendWhatsAppMessage(
      whatsappConfig.businessPhoneNumberId,
      envConfig.ownerWhatsapp,
      `🔔 *CHECKOUT PAGO — ENVIAR AGORA*\n\n📦 Produto: ${checkout.produto ?? 'Rastreador GPS 2 em 1'}\n👤 Nome: ${checkout.nomeCliente ?? 'Não informado'}\n📍 Endereço: ${enderecoFormatado || 'Não informado'}\n💰 Valor: R$ ${checkout.valorProduto.toFixed(2)}\n💳 Pagamento: ${formaPagLabel}\n📱 WhatsApp: ${checkout.telefoneCliente}\n\n✅ Pagamento confirmado — pronto para envio`,
      whatsappConfig.accessToken ?? undefined,
    );

    console.log(`[MP WEBHOOK] ✅ Checkout pago notificado | checkout ${checkout.id}`);
    return;
  }

  // ── Fallback: PedidoNacional ───────────────────────────────────────────────
  const pedido = await prisma.pedidoNacional.findFirst({
    where: { pagamentoId: paymentId },
  });

  if (!pedido) {
    console.error(`[MP WEBHOOK] Nenhum checkout ou pedido encontrado para payment ${paymentId}`);
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

  await sendWhatsAppMessage(
    config.businessPhoneNumberId,
    envConfig.ownerWhatsapp,
    `🔔 *PEDIDO PAGO — ENVIAR AGORA*\n\n📦 Produto: ${pedido.produto}\n👤 Nome: ${pedido.nomeCliente}\n📍 CEP: ${pedido.cepDestino}\n📮 Endereço: ${pedido.enderecoCompleto}\n💰 Valor pago: R$ ${pedido.valorTotal.toFixed(2)}\n💳 Pagamento: ${pedido.formaPagamento}\n📱 WhatsApp: ${pedido.telefoneCliente}\n\n✅ Pagamento confirmado — pronto para envio`,
    config.accessToken ?? undefined,
  );

  console.log(`[MP WEBHOOK] ✅ Notificação de pedido pago enviada para Pedro | pedido ${pedido.id}`);
}
