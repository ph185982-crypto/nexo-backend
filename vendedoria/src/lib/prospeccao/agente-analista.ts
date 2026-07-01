// Agente analista — classifica ProspectLeads via LLM (não conversacional)
// Usa OpenAI para chamada única, sem histórico

import { prisma } from "@/lib/prisma/client";

type Classificacao = "APROVAR_AUTO" | "REVISAR" | "DESCARTAR";

interface AnaliseResult {
  classificacao: Classificacao;
  motivo: string;
}

const SYSTEM_PROMPT = `Você é um analista de qualificação de leads B2B.
Sua tarefa é avaliar se um negócio local deve ser abordado pela agência de marketing digital Nexos Brasil.

Critérios:
- APROVAR_AUTO: negócio claramente pertence ao segmento buscado, tem telefone válido, tem sinais claros de oportunidade digital (sem site/anúncio/IG).
- REVISAR: dúvida razoável sobre o segmento, ou dados incompletos, ou sinais ambíguos.
- DESCARTAR: nome/contexto não bate com o segmento, sem telefone, ou negócio claramente não é o alvo.

Responda APENAS JSON válido, sem explicação fora do JSON:
{ "classificacao": "APROVAR_AUTO" | "REVISAR" | "DESCARTAR", "motivo": "string curta, uma frase" }`;

async function chamarLLM(prompt: string): Promise<AnaliseResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[AgenteAnalista] OPENAI_API_KEY não configurado");
    return null;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        messages:    [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: prompt },
        ],
        max_tokens:  150,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      console.error(`[AgenteAnalista] OpenAI ${res.status}:`, await res.text());
      return null;
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<AnaliseResult>;
    const classificacao = parsed.classificacao;
    if (!classificacao || !["APROVAR_AUTO", "REVISAR", "DESCARTAR"].includes(classificacao)) {
      console.error("[AgenteAnalista] Classificação inválida:", classificacao);
      return null;
    }

    return {
      classificacao: classificacao as Classificacao,
      motivo: parsed.motivo ?? "sem motivo",
    };
  } catch (e) {
    console.error("[AgenteAnalista] Erro LLM:", e);
    return null;
  }
}

export async function analisarLead(leadId: string): Promise<void> {
  const lead = await prisma.prospectLead.findUnique({
    where:   { id: leadId },
    include: { segment: { select: { nome: true, termoBusca: true, limiarScoreQualificado: true } } },
  });

  if (!lead) throw new Error(`ProspectLead ${leadId} não encontrado`);
  if (lead.status !== "PONTUADO") {
    console.warn(`[AgenteAnalista] Lead ${leadId} não está em status PONTUADO (está: ${lead.status})`);
    return;
  }

  const limiar = lead.segment?.limiarScoreQualificado ?? 4;
  if ((lead.score ?? 0) < limiar) {
    // Abaixo do limiar — descarta direto sem chamar LLM
    await prisma.prospectLead.update({
      where: { id: leadId },
      data: {
        analiseIA:       "DESCARTAR",
        motivoAnaliseIA: `Score ${lead.score} abaixo do limiar ${limiar}`,
        status:          "DESCARTADO",
      },
    });
    return;
  }

  // Monta prompt com dados do lead
  const sinais: string[] = [];
  if (lead.temSite !== null)        sinais.push(`Site: ${lead.temSite ? "SIM" : "NÃO"}`);
  if (lead.temAnuncioAtivo !== null) sinais.push(`Anúncio ativo: ${lead.temAnuncioAtivo ? "SIM" : "NÃO"}`);
  if (lead.instagramAtivo !== null)  sinais.push(`Instagram ativo: ${lead.instagramAtivo ? "SIM" : "NÃO"}`);
  if (lead.ratingGoogle !== null)    sinais.push(`Rating Google: ${lead.ratingGoogle.toFixed(1)} (${lead.numeroAvaliacoes} avaliações)`);
  if (lead.followersIG)              sinais.push(`Seguidores Instagram: ${lead.followersIG}`);

  const prompt = [
    `Segmento buscado: "${lead.segment?.termoBusca ?? "?"}" (nome do segmento: "${lead.segment?.nome ?? "?"}")`,
    ``,
    `Dados do negócio:`,
    `  Nome: ${lead.nome ?? "não informado"}`,
    `  Telefone: ${lead.telefone ?? "não informado"}`,
    `  Endereço: ${lead.enderecoCompleto ?? "não informado"}`,
    `  Site: ${lead.website ?? "não tem"}`,
    ``,
    `Sinais digitais:`,
    ...sinais.map((s) => `  - ${s}`),
    ``,
    `Score de qualificação: ${lead.score}/${limiar} (limiar para aprovação)`,
  ].join("\n");

  const analise = await chamarLLM(prompt);

  if (!analise) {
    // LLM falhou — coloca para revisão humana
    await prisma.prospectLead.update({
      where: { id: leadId },
      data: {
        analiseIA:       "REVISAR",
        motivoAnaliseIA: "LLM indisponível — revisão manual necessária",
        status:          "ANALISADO",
      },
    });
    return;
  }

  const novoStatus =
    analise.classificacao === "APROVAR_AUTO" ? "APROVADO" :
    analise.classificacao === "REVISAR"      ? "ANALISADO" :
    "DESCARTADO";

  await prisma.prospectLead.update({
    where: { id: leadId },
    data: {
      analiseIA:       analise.classificacao,
      motivoAnaliseIA: analise.motivo,
      status:          novoStatus,
    },
  });

  console.log(`[AgenteAnalista] Lead ${leadId} "${lead.nome}" → ${analise.classificacao} | ${analise.motivo}`);
}

export async function analisarLote(segmentId: string): Promise<{
  aprovados: number;
  revisao: number;
  descartados: number;
  erros: number;
}> {
  const leads = await prisma.prospectLead.findMany({
    where: { segmentId, status: "PONTUADO" },
    select: { id: true },
    take: 50,
  });

  const result = { aprovados: 0, revisao: 0, descartados: 0, erros: 0 };

  for (const lead of leads) {
    try {
      await analisarLead(lead.id);
      const updated = await prisma.prospectLead.findUnique({
        where: { id: lead.id },
        select: { status: true },
      });
      if (updated?.status === "APROVADO")    result.aprovados++;
      else if (updated?.status === "ANALISADO") result.revisao++;
      else if (updated?.status === "DESCARTADO") result.descartados++;
    } catch (e) {
      console.error(`[AgenteAnalista] Erro no lead ${lead.id}:`, e);
      result.erros++;
    }
    // Pausa entre chamadas LLM
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`[AgenteAnalista] Lote ${segmentId} — aprovados=${result.aprovados} revisao=${result.revisao} descartados=${result.descartados} erros=${result.erros}`);
  return result;
}
