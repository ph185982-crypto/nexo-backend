import axios from 'axios';

const BASE = 'https://melhorenvio.com.br/api/v2';

const getHeaders = () => ({
  Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'Vendedoria/1.0 (contato@nexobrasil.com.br)',
});

export interface OpcaoFrete {
  id: string;
  transportadora: string;
  servico: string;
  prazo: number;
  preco: number;
}

export async function cotarFrete(cepDestino: string): Promise<OpcaoFrete[]> {
  const cepLimpo = cepDestino.replace(/\D/g, '');

  const { data } = await axios.post(
    `${BASE}/me/shipment/calculate`,
    {
      from: { postal_code: process.env.CEP_ORIGEM?.replace(/\D/g, '') },
      to: { postal_code: cepLimpo },
      products: [{
        id: 'ferramenta-impacto',
        width: 35,
        height: 22,
        length: 42,
        weight: 2.5,
        insurance_value: 600,
        quantity: 1,
      }],
      options: {
        insurance_value: 600,
        receipt: false,
        own_hand: false,
      },
    },
    { headers: getHeaders() },
  );

  return data
    .filter((s: { error?: string; price?: number }) => !s.error && s.price)
    .map((s: {
      id: number;
      company: { name: string };
      name: string;
      delivery_time: number;
      price: string;
    }) => ({
      id: String(s.id),
      transportadora: s.company.name,
      servico: s.name,
      prazo: s.delivery_time,
      preco: parseFloat(s.price),
    }))
    .sort((a: OpcaoFrete, b: OpcaoFrete) => a.preco - b.preco)
    .slice(0, 4);
}

export async function adicionarAoCarrinho(pedido: {
  cepDestino: string;
  nomeDestinatario: string;
  servicoId: string;
  produtoNome: string;
  valorProduto: number;
}): Promise<string> {
  const { data } = await axios.post(
    `${BASE}/me/cart`,
    {
      service: pedido.servicoId,
      from: {
        name: 'Nexo Brasil',
        postal_code: process.env.CEP_ORIGEM?.replace(/\D/g, ''),
        address: 'Endereço de despacho',
        city: 'Goiânia',
        state_abbr: 'GO',
        country_id: 'BR',
      },
      to: {
        name: pedido.nomeDestinatario,
        postal_code: pedido.cepDestino.replace(/\D/g, ''),
      },
      products: [{
        name: pedido.produtoNome,
        quantity: 1,
        unitary_value: pedido.valorProduto,
      }],
      options: {
        insurance_value: pedido.valorProduto,
        receipt: false,
        own_hand: false,
      },
    },
    { headers: getHeaders() },
  );

  return data.id;
}

export async function gerarEtiqueta(cartItemId: string): Promise<string> {
  await axios.post(
    `${BASE}/me/shipment/checkout`,
    { orders: [cartItemId] },
    { headers: getHeaders() },
  );

  await axios.post(
    `${BASE}/me/shipment/generate`,
    { orders: [cartItemId] },
    { headers: getHeaders() },
  );

  const { data } = await axios.post(
    `${BASE}/me/shipment/print`,
    { mode: 'public', orders: [cartItemId] },
    { headers: getHeaders() },
  );

  return data.url;
}

export async function buscarRastreamento(cartItemId: string): Promise<string | null> {
  const { data } = await axios.get(
    `${BASE}/me/shipment/tracking?orders[]=${cartItemId}`,
    { headers: getHeaders() },
  );
  return data[cartItemId]?.tracking || null;
}
