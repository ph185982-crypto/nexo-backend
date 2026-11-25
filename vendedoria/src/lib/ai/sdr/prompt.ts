// System prompt da SDR = ROTEIRO DA JÚLIA (fonte única em ./julia/roteiro.ts) + o contexto deste turno + o formato
// de resposta. As decisões (rota, pergunta, horários, passagem) são do código (./julia/motor.ts); o modelo lê o que o
// lead disse, reage e responde dúvidas.
import { type SDRSession } from "./types";
import { roteiroDa, personaAtual } from "./julia/persona";
import { classificar, proximaPergunta, ROTULO_FAIXA } from "./julia/icp";
import { PERGUNTA_TEXTO } from "./julia/motor";
import type { Slot } from "@/lib/agenda/slots";

// Telefone do Pedro, legível ("62 98446-5388" em vez de "5562984465388").
export function formatarTelefoneOwner(): string {
  const digits = (process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388").replace(/\D/g, "");
  const semPais = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (semPais.length === 11) return `${semPais.slice(0, 2)} ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  return semPais;
}

export interface ContextoTurno {
  slots?: Slot[];
}

function resumoSessao(s: SDRSession): string {
  const linhas = [
    s.nome && `nome: ${s.nome}`,
    s.empresa && `empresa: ${s.empresa}`,
    s.segmento && `vende: ${s.segmento}`,
    s.marketplace_atual?.length ? `marketplaces hoje: ${s.marketplace_atual.join(", ")}` : null,
    s.loja_fisica === "sim" ? `loja/estoque próprio: SIM${s.tipo_estoque ? ` (${s.tipo_estoque})` : ""}` : s.loja_fisica === "nao" ? "loja/estoque próprio: NÃO" : null,
    s.cnpj && `CNPJ: ${s.cnpj}`,
    s.faixa_faturamento !== undefined ? `faturamento atual: ${ROTULO_FAIXA[s.faixa_faturamento]}` : null,
  ].filter(Boolean);
  return linhas.length ? linhas.map((l) => `- ${l}`).join("\n") : "- (nada ainda)";
}

export function buildSdrSystemPrompt(session: SDRSession, whatsappProfileName?: string | null, contexto?: ContextoTurno): string {
  const icp = classificar(session);
  const proxima = proximaPergunta(session);
  const slots = contexto?.slots ?? [];
  return `[SDR]
${roteiroDa(personaAtual())}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO DESTE TURNO (do sistema)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agora em Brasília: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
Nome do perfil do WhatsApp: "${whatsappProfileName?.trim() || "não disponível"}" (pode ser nome da loja; só use como nome se for nome de pessoa)
O que o lead JÁ respondeu (NUNCA pergunte de novo):
${resumoSessao(session)}
Situação: ${icp}${proxima ? ` — a próxima pergunta do roteiro é: "${PERGUNTA_TEXTO[proxima]}"` : ""}
${slots.length ? `Horários livres para a ligação (use exatamente estes rótulos): ${slots.map((x) => `"${x.label}" [${x.iso}]`).join(" ou ")}` : ""}

O sistema já manda sozinho: a abertura, a pergunta de faturamento, os horários da ligação, a confirmação, e as mensagens das rotas MORNO e FORA. A SUA parte neste turno:
1. Reagir ao que o lead disse em UMA frase curta (sem pergunta), ou responder a pergunta dele (PERGUNTAS FREQUENTES).
2. Se ainda falta algo, fazer só a próxima pergunta do roteiro (acima). Uma por vez.
3. Ler a resposta do lead e preencher updateSession.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RETORNO — OBRIGATÓRIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Retorne APENAS um JSON válido, sem markdown:
{
  "messages": [{"text": "mensagem curta", "delay": 0}, {"text": "outra", "delay": 1500}],
  "updateSession": {
    "nome": "nome da PESSOA, se ela disse (não o da loja)",
    "empresa": "nome da empresa/loja, se disse",
    "segmento": "o que vende (ex.: 'moda feminina')",
    "marketplace_atual": ["marketplaces onde já vende, se disse"],
    "loja_fisica": "'sim' se tem loja física OU fábrica/atacado com estoque próprio; 'nao' se não tem nenhum (começando, afiliado, revende sem estoque, só ideia). Só quando o lead responder.",
    "tipo_estoque": "'loja física', 'fábrica', 'atacado' ou 'estoque próprio', se disse",
    "cnpj": "'tem' ou 'nao tem', só quando o lead responder",
    "faixa_faturamento": "1, 2, 3 ou 4 conforme a resposta à pergunta de faturamento ATUAL (0 se não quis dizer). Nunca meta, previsão ou esperado.",
    "horario_escolhido": "o ISO [entre colchetes] do horário que o lead escolheu, só se ele escolheu um dos oferecidos",
    "frase_chave": "o trecho mais importante que o lead disse sobre o negócio (até 120 caracteres)"
  },
  "action": "continue"
}
Regras: 1 a 3 mensagens; inclua em updateSession só o que o lead disse (NUNCA pergunte de novo o que já está acima); nunca diga "Nexo", nunca cite "600", nunca cite preço, nunca se apresente como Pedro.`;
}
