// Detector de intenção por regras (sem chamada ao modelo: custo zero e determinístico).
// Lê a mensagem do lead e devolve sinais da lista fechada do CRM Avanteza
// (crm/src/lib/atividades/intencoes.ts). Padrões conservadores: melhor perder um
// sinal do que marcar um falso — o vendedor ainda registra à mão no CRM.

export type Intencao =
  | "OBJECAO_PRECO" | "CONCORRENTE_IDENTIFICADO" | "DECISAO_ADIADA" | "URGENCIA_DECLARADA" | "BUDGET_SINALIZADO"
  | "DECISOR_IDENTIFICADO" | "SINAL_FECHAMENTO" | "PROVA_VALOR_ACEITA" | "DOR_CONFIRMADA";

const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const REGRAS: Array<[Intencao, RegExp]> = [
  ["OBJECAO_PRECO", /\b(caro|careza|muito alto|valor (alto|elevado)|nao (tenho|tem) (dinheiro|grana|verba)|fora do (meu )?orcamento|sem condicoes? de pagar|preco (esta|ta) (alto|puxado))\b/],
  ["CONCORRENTE_IDENTIFICADO", /\b(ja (uso|contratei|trabalho com)|outra (empresa|consultoria|agencia)|concorrente|(vendo|comparando) outras? (opcoes|propostas)|outras propostas)\b/],
  ["DECISAO_ADIADA", /\b(vou pensar|preciso pensar|depois (eu )?(te )?(falo|chamo|retorno)|semana que vem|mes que vem|mais pra frente|agora nao (da|e o momento)|outro momento)\b/],
  ["URGENCIA_DECLARADA", /\b(urgente|urgencia|o mais rapido possivel|preciso (disso )?(pra|para) (ontem|ja|hoje|essa semana)|quanto antes)\b/],
  ["BUDGET_SINALIZADO", /\b(tenho (verba|orcamento)|posso investir|disposto a investir|consigo pagar|cabe no (meu )?orcamento|orcamento (de|e|ta) )/],
  ["DECISOR_IDENTIFICADO", /\b(sou (o )?(dono|socio|proprietario|diretor|ceo)|eu (que )?(decido|mando)|a decisao e minha)\b/],
  ["SINAL_FECHAMENTO", /\b(quero (contratar|fechar|comecar)|vamos fechar|bora fechar|pode (mandar|enviar) (o )?(contrato|proposta)|como (eu )?(pago|faco pra contratar))\b/],
  ["PROVA_VALOR_ACEITA", /\b(faz sentido|gostei (da|do|disso)|isso resolve|era isso que (eu )?(procurava|precisava))\b/],
  ["DOR_CONFIRMADA", /\b(meu (maior )?(problema|dor) e|estou perdendo (dinheiro|clientes|vendas|margem)|nao sei onde (estou )?perdendo)\b/],
];

/** Sinais encontrados na mensagem (no máximo 2, na ordem das regras). */
export function detectarIntencoes(mensagem: string): Intencao[] {
  const n = normalizar(mensagem ?? "");
  if (n.length < 4 || n.length > 2000) return [];
  const achadas: Intencao[] = [];
  for (const [intencao, regra] of REGRAS) {
    if (regra.test(n)) achadas.push(intencao);
    if (achadas.length === 2) break;
  }
  return achadas;
}
