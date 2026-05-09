import MercadoPago, { Payment, Preference } from 'mercadopago';

const getMp = () => new MercadoPago({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
});

export interface ResultadoPix {
  pagamentoId: string;
  pixCopiaECola: string;
  qrCodeBase64: string;
  valor: number;
  expiracaoMinutos: number;
}

export interface ResultadoParcelado {
  pagamentoId: string;
  linkPagamento: string;
  valor: number;
}

export async function criarPix(params: {
  pedidoId: string;
  valor: number;
  descricao: string;
  nomeCliente: string;
}): Promise<ResultadoPix> {
  const payment = new Payment(getMp());

  const resultado = await payment.create({
    body: {
      transaction_amount: params.valor,
      description: params.descricao,
      payment_method_id: 'pix',
      payer: {
        email: 'pagamento@nexobrasil.com.br',
        first_name: params.nomeCliente.split(' ')[0],
        last_name: params.nomeCliente.split(' ').slice(1).join(' ') || 'Cliente',
      },
      external_reference: params.pedidoId,
      notification_url: `${process.env.RENDER_EXTERNAL_URL}/api/pagamentos/webhook`,
      date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  });

  return {
    pagamentoId: String(resultado.id),
    pixCopiaECola: resultado.point_of_interaction?.transaction_data?.qr_code || '',
    qrCodeBase64: resultado.point_of_interaction?.transaction_data?.qr_code_base64 || '',
    valor: params.valor,
    expiracaoMinutos: 30,
  };
}

export async function criarLinkParcelado(params: {
  pedidoId: string;
  valor: number;
  descricao: string;
  nomeCliente: string;
}): Promise<ResultadoParcelado> {
  const preference = new Preference(getMp());

  const resultado = await preference.create({
    body: {
      items: [{
        id: params.pedidoId,
        title: params.descricao,
        unit_price: params.valor,
        quantity: 1,
        currency_id: 'BRL',
      }],
      payer: { name: params.nomeCliente },
      payment_methods: {
        installments: 10,
        excluded_payment_types: [{ id: 'ticket' }],
      },
      external_reference: params.pedidoId,
      notification_url: `${process.env.RENDER_EXTERNAL_URL}/api/pagamentos/webhook`,
      statement_descriptor: 'NEXO BRASIL',
      expires: true,
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });

  return {
    pagamentoId: resultado.id!,
    linkPagamento: resultado.init_point!,
    valor: params.valor,
  };
}

export async function consultarStatus(paymentId: string): Promise<string> {
  const payment = new Payment(getMp());
  const resultado = await payment.get({ id: Number(paymentId) });
  return resultado.status || 'unknown';
}
