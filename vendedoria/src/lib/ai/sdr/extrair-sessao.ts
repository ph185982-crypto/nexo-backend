// Recupera da CONVERSA os dados que o lead já respondeu mas o modelo não gravou na sessão.
//
// Por que existe (17/11/2026): com a DeepSeek o modelo escreve a despedida ("vou te conectar com o
// Pedro…") mas deixa campos de `updateSession` vazios (ex.: a Eloisa disse "sim, tenho CNPJ" e o
// `cnpj` ficou em branco). O portão do handoff via "falta CNPJ", bloqueava o bastão e a despedida
// saía mesmo assim: o lead ficava esperando uma ligação que o Pedro nunca soube que existia.
// Aqui uma chamada curta e barata lê o que o LEAD disse e preenche SÓ o que está faltando.

import { deepseekAtivo, deepseekChat } from "@/lib/ai/deepseek";
import { faltandoParaHandoff, pareceNomeDePessoa, type ItemHandoff } from "./handoff-gate";
import type { SDRSession } from "./types";

type Msg = { role: "user" | "assistant"; content: string };

const CAMPO_POR_ITEM: Record<ItemHandoff, string> = {
  nome: "nome (nome da PESSOA, não da empresa)",
  empresa: "empresa (nome da empresa/loja)",
  segmento: "segmento (o que vende, ex.: moda feminina, cosméticos)",
  dor: "problema_principal (o que trava as vendas hoje, nas palavras dele, 15+ caracteres)",
  faturamento: "faturamento_total (faturamento mensal em texto: '54 reais no primeiro dia', 'ainda não fatura', '5 mil')",
  loja_fisica: 'loja_fisica ("sim" ou "nao")',
  cnpj: 'cnpj ("tem" ou "nao tem")',
  horario: "disponibilidade (quando pode falar: 'amanhã às 14h', 'agora')",
};

/** Interpreta a resposta do modelo e devolve só campos válidos, dentro do que foi pedido. */
export function validarExtracao(bruto: unknown, pedidos: ItemHandoff[]): Partial<SDRSession> {
  if (!bruto || typeof bruto !== "object") return {};
  const o = bruto as Record<string, unknown>;
  const txt = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const out: Partial<SDRSession> = {};
  for (const item of pedidos) {
    if (item === "nome") { const v = txt("nome"); if (pareceNomeDePessoa(v)) out.nome = v; }
    else if (item === "empresa") { const v = txt("empresa"); if (v.length >= 2 && v.length <= 80) out.empresa = v; }
    else if (item === "segmento") { const v = txt("segmento"); if (v.length >= 3 && v.length <= 80) out.segmento = v; }
    else if (item === "dor") { const v = txt("problema_principal"); if (v.length >= 15 && v.length <= 300) out.problema_principal = v; }
    else if (item === "faturamento") { const v = txt("faturamento_total"); if (v.length >= 2 && v.length <= 120) out.faturamento_total = v; }
    else if (item === "loja_fisica") { const v = txt("loja_fisica").toLowerCase(); if (v === "sim" || v === "nao") out.loja_fisica = v; }
    else if (item === "cnpj") {
      const v = txt("cnpj").toLowerCase().replace("não", "nao");
      if (v === "tem" || v === "nao tem") out.cnpj = v;
    }
    else if (item === "horario") { const v = txt("disponibilidade"); if (v.length >= 2 && v.length <= 120) out.disponibilidade = v; }
  }
  return out;
}

/**
 * Pergunta ao modelo, olhando a conversa, só pelos itens que faltam. Devolve o que o LEAD de fato
 * disse (nunca inventa). Sem DeepSeek, erro ou resposta vazia: devolve {} e o fluxo segue como antes.
 */
export async function extrairDadosFaltantes(faltando: ItemHandoff[], conversa: Msg[], timeoutMs = 8_000): Promise<Partial<SDRSession>> {
  if (faltando.length === 0 || !deepseekAtivo()) return {};
  const transcricao = conversa
    .slice(-24)
    .map((m) => `${m.role === "user" ? "LEAD" : "IA"}: ${m.content.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const r = await deepseekChat(
    [
      {
        role: "system",
        content:
          "Você extrai dados de uma conversa de WhatsApp entre uma IA de vendas (IA) e um lead (LEAD). " +
          "Use SOMENTE o que o LEAD disse, mesmo que de forma curta ('sim tenho', 'não', 'amanhã 14h'). " +
          "Nunca invente. Se o LEAD não disse, use null. Responda APENAS um objeto JSON com estas chaves: " +
          faltando.map((i) => CAMPO_POR_ITEM[i]).join("; ") + ".",
      },
      { role: "user", content: `Conversa:\n${transcricao}\n\nDevolva o JSON.` },
    ],
    { maxTokens: 300, temperature: 0, json: true, timeoutMs },
  );
  if (!r) return {};
  try {
    const m = r.match(/\{[\s\S]*\}/);
    return validarExtracao(JSON.parse(m ? m[0] : r), faltando);
  } catch {
    return {};
  }
}

/**
 * Completa a sessão com o que o lead já disse na conversa e o modelo não gravou. Usado antes de
 * escrever um follow-up: sem isso o acompanhamento "descobria" que faltava o nome de quem já tinha
 * se apresentado ("como você gosta de ser chamada?" para a Luciana e a Rosângela, 17/11).
 */
export async function completarSessaoPelaConversa(
  s: SDRSession,
  conversa: Msg[],
  timeoutMs = 8_000,
): Promise<{ sessao: SDRSession; preenchidos: string[] }> {
  const faltando = faltandoParaHandoff(s);
  if (faltando.length === 0) return { sessao: s, preenchidos: [] };
  const extra = await extrairDadosFaltantes(faltando, conversa, timeoutMs);
  const preenchidos = Object.keys(extra);
  if (preenchidos.length === 0) return { sessao: s, preenchidos: [] };
  const sessao: SDRSession = { ...s, ...extra };
  if (sessao.loja_fisica === "sim") sessao.tem_loja_fisica = true;
  else if (sessao.loja_fisica === "nao") sessao.tem_loja_fisica = false;
  return { sessao, preenchidos };
}
