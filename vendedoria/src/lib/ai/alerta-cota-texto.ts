// Texto dos alertas de saldo da IA (sem banco: testável isolado).
const ONDE_RECARREGAR: Record<string, string> = {
  OpenAI: "OpenAI: platform.openai.com → Billing",
  DeepSeek: "DeepSeek: platform.deepseek.com → Top up",
  Anthropic: "Anthropic: console.anthropic.com → Billing",
};
/**
 * Texto do alerta. Se o provedor sem saldo é a DeepSeek e há OpenAI de reserva (o sistema pula a DeepSeek por 20 min e
 * atende pela OpenAI), os leads NÃO estão parados: o aviso diz isso e só pede a recarga para voltar ao custo baixo.
 */
export function textoAlertaCota(provedor: string, detalhe: string, temReserva: boolean): { titulo: string; corpo: string } {
  const onde = ONDE_RECARREGAR[provedor] ?? "no painel do provedor";
  const det = `\n\nDetalhe: ${detalhe.slice(0, 300)}`;
  if (provedor === "DeepSeek" && temReserva) {
    return {
      titulo: "💳 DeepSeek sem saldo — atendendo pela OpenAI (mais cara)",
      corpo: `A DeepSeek está sem saldo, mas os atendimentos continuam normais: o sistema usa a OpenAI. Para voltar ao custo baixo, adicione créditos (${onde}).${det}`,
    };
  }
  return {
    titulo: `💳 ${provedor} sem créditos — a IA parou de responder`,
    corpo: `O provedor ${provedor} recusou a chamada por falta de crédito. Leads estão recebendo a mensagem de espera. ` +
      `Adicione créditos (${onde}) e ative a recarga automática.${det}`,
  };
}

