import type { OpcaoFrete } from '@/lib/envio/melhor-envio';

const AREA_LOCAL = [
  'goiânia', 'goiania', 'aparecida de goiânia', 'aparecida de goiania',
  'trindade', 'senador canedo', 'goianira', 'nerópolis', 'neropolis',
  'hidrolândia', 'hidrolandia', 'abadia de goiás', 'abadia de goias',
  'aragoiânia', 'aragoiania', 'guapó', 'guapo', 'inhumas',
  'anápolis', 'anapolis', 'bonfinópolis', 'bonfinopolis',
  'terezópolis', 'terezopolis',
];

const PADROES_NACIONAL = [
  /\b(são paulo|sao paulo|rio de janeiro|belo horizonte|salvador|fortaleza|curitiba|manaus|recife|porto alegre|belém|belem|são luís|sao luis|maceió|maceio|natal|teresina|campo grande|joão pessoa|joao pessoa|aracaju|porto velho|macapá|macapa|boa vista|palmas|rio branco|florianópolis|florianopolis|vitória|vitoria|cuiabá|cuiaba)\b/i,
  /\b(sp|rj|mg|ba|ce|pr|am|pe|rs|pa|ma|al|rn|pi|ms|pb|se|ro|ap|rr|to|ac|sc|es|mt)\b/,
  /\bfrete\b/i,
  /entrega.*todo.*brasil/i,
  /voc[eê]s\s+entreg/i,
  /entreg[a-z]+\s+(n[ao]|pra)\s+/i,
  /minha\s+cidade/i,
  /meu\s+estado/i,
  /\btransportadora\b/i,
];

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function detectarClienteNacional(historico: string[]): boolean {
  const texto = historico.map(normalize).join(' ');

  if (AREA_LOCAL.some(local => texto.includes(normalize(local)))) return false;
  return PADROES_NACIONAL.some(padrao => padrao.test(texto));
}

export function detectarCEP(mensagem: string): string | null {
  const match = mensagem.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? match[1] + match[2] : null;
}

export function detectarEscolhaFrete(
  mensagem: string,
  opcoes: OpcaoFrete[]
): string | null {
  if (!opcoes?.length) return null;
  const texto = normalize(mensagem);

  if (/\b(1|um|primeira|mais barat|econom)/.test(texto)) {
    return [...opcoes].sort((a, b) => a.preco - b.preco)[0]?.id ?? null;
  }
  if (/\b(2|dois|segunda|mais rapid|rapido|sedex|expresso)/.test(texto)) {
    return [...opcoes].sort((a, b) => a.prazo - b.prazo)[0]?.id ?? null;
  }

  for (const opcao of opcoes) {
    if (texto.includes(normalize(opcao.transportadora))) {
      return opcao.id;
    }
  }

  return null;
}

export function detectarFormaPagamento(
  mensagem: string
): 'pix' | 'parcelado' | null {
  const texto = normalize(mensagem);

  if (/\b(pix|a vista|dinheiro)\b/.test(texto)) return 'pix';
  if (/\b(parcel|cartao|credito|10x|vezes)\b/.test(texto)) return 'parcelado';

  return null;
}
