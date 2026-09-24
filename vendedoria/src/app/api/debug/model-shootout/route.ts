import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildSdrSystemPrompt } from "@/lib/ai/sdr/prompt";
import { callOpenAI } from "@/lib/ai/llm-client";
import type { SDRSession } from "@/lib/ai/sdr/types";

// Comparação lado a lado de modelos no PROMPT REAL do SDR, sem tocar em lead/conversa
// real. Só leitura — nenhuma escrita no banco, nenhum WhatsApp enviado.

const SESSAO_BASE: SDRSession = {
  mode: "SDR",
  nome: "",
  canais_atuais: [],
  tem_loja_fisica: false,
  faturamento_total: "",
  ja_vende_marketplace: false,
  marketplace_atual: [],
  problema_principal: "",
  cnpj: "",
  opera_com_equipe: null,
  disponibilidade: "",
  score: 0,
  rota: "",
  produto_indicado: "",
  objecoes_mencionadas: [],
  status: "em_qualificacao",
  etapa: "QUALIFICANDO",
};

const CENARIOS: Array<{ nome: string; historico: Array<{ role: "user" | "assistant"; content: string }>; mensagem: string }> = [
  {
    nome: "abertura",
    historico: [],
    mensagem: "oi, vi um anúncio de vocês sobre vender mais na shopee",
  },
  {
    nome: "objecao_preco",
    historico: [
      { role: "assistant", content: "legal! me conta, hoje você já vende em algum marketplace ou só loja física?" },
      { role: "user", content: "só instagram mesmo, vendo roupa feminina" },
      { role: "assistant", content: "entendi, e mais ou menos quanto vc fatura por mês hoje?" },
      { role: "user", content: "uns 8 mil, varia bastante" },
    ],
    mensagem: "quanto custa isso? pq já vi que consultoria desse tipo é caro",
  },
  {
    nome: "fechamento",
    historico: [
      { role: "user", content: "vendo bolsa e acessório, faturamento uns 15k/mês, quero profissionalizar" },
      { role: "assistant", content: "perfeito, com esse perfil faz sentido bater um papo com nosso especialista" },
    ],
    mensagem: "bora, como funciona pra agendar",
  },
];

const MODELOS = ["gpt-4o", "gpt-4o-mini", "gpt-6-luna"];

export async function POST() {
  if (!(await auth())?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const systemPrompt = buildSdrSystemPrompt(SESSAO_BASE, "Cliente Teste");

  const resultados = [];
  for (const cenario of CENARIOS) {
    const porModelo: Record<string, { ok: boolean; resposta: string | null; ms: number }> = {};
    for (const model of MODELOS) {
      const t0 = Date.now();
      const resposta = await callOpenAI(systemPrompt, cenario.historico, cenario.mensagem, model, {
        maxTokens: 1000,
        temperature: 0.7,
        responseFormat: "json_object",
      });
      porModelo[model] = { ok: resposta !== null, resposta, ms: Date.now() - t0 };
    }
    resultados.push({ cenario: cenario.nome, mensagem: cenario.mensagem, porModelo });
  }

  return NextResponse.json({ resultados });
}
