import { prisma } from "@/lib/prisma/client";

const STATUSES_POSITIVOS = ["REUNIAO_AGENDADA", "QUALIFICADO"];
const STATUSES_FINAIS = ["REUNIAO_AGENDADA", "QUALIFICADO", "PERDIDO", "DESCARTADO"];
const MINIMO_LEADS_PARA_SUGESTAO = 30;

interface SugestaoSinal {
  sinal: string;
  pesoAtual: number;
  pesoSugerido: number;
  taxaComSinal: number;
  taxaSemSinal: number;
  justificativa: string;
}

function calcularNovoPeso(pesoAtual: number, taxaComSinal: number, taxaSemSinal: number): number {
  const diferencaRelativa = taxaSemSinal - taxaComSinal; // leads SEM o sinal convertem menos?

  if (Math.abs(diferencaRelativa) < 0.03) {
    // Correlação fraca (< 3% diferença) — sinal tem pouco impacto
    return Math.max(1, Math.round(pesoAtual * 0.7));
  }

  if (diferencaRelativa > 0.1) {
    // Sinal ausente correlaciona fortemente com baixa conversão — aumentar peso
    return Math.min(10, Math.round(pesoAtual * 1.5));
  }

  if (diferencaRelativa < -0.05) {
    // Sinal presente correlaciona com baixa conversão — reduzir peso
    return Math.max(0, Math.round(pesoAtual * 0.5));
  }

  return pesoAtual; // manter
}

/**
 * Analisa os leads com desfecho final do segmento e sugere ajuste de pesos.
 * Retorna null se não houver dados suficientes (< 30 leads com desfecho).
 * NUNCA aplica automaticamente — apenas sugere.
 */
export async function sugerirAjustePesos(segmentId: string): Promise<SugestaoSinal[] | null> {
  const segment = await prisma.prospectSegment.findUnique({
    where: { id: segmentId },
  });
  if (!segment) return null;

  // Apenas leads com desfecho final (pós-resposta ou descartado pelo analista)
  const leads = await prisma.prospectLead.findMany({
    where: {
      segmentId,
      status: { in: STATUSES_FINAIS },
    },
    select: {
      status: true,
      temSite: true,
      temAnuncioAtivo: true,
      instagramAtivo: true,
      ratingGoogle: true,
    },
  });

  if (leads.length < MINIMO_LEADS_PARA_SUGESTAO) {
    return null;
  }

  const totalLeads = leads.length;
  const totalPositivos = leads.filter((l) => STATUSES_POSITIVOS.includes(l.status)).length;
  const taxaGeral = totalPositivos / totalLeads;

  const sinais: Array<{
    chave: string;
    label: string;
    pesoAtual: number;
    testarAusencia: (l: typeof leads[0]) => boolean | null;
  }> = [
    {
      chave: "temSite",
      label: "Sem site",
      pesoAtual: segment.pesoSemSite,
      testarAusencia: (l) => l.temSite,
    },
    {
      chave: "temAnuncioAtivo",
      label: "Sem anúncio ativo",
      pesoAtual: segment.pesoSemAnuncioAtivo,
      testarAusencia: (l) => l.temAnuncioAtivo,
    },
    {
      chave: "instagramAtivo",
      label: "Instagram parado",
      pesoAtual: segment.pesoInstagramParado,
      testarAusencia: (l) => l.instagramAtivo,
    },
    {
      chave: "ratingBaixo",
      label: "Rating Google baixo",
      pesoAtual: segment.pesoRatingBaixo,
      testarAusencia: (l) => (l.ratingGoogle !== null ? l.ratingGoogle >= 4.0 : null),
    },
  ];

  const sugestoes: SugestaoSinal[] = [];

  for (const sinal of sinais) {
    // Leads com o sinal presente (condição ruim: sem site, sem anúncio, etc.)
    const comSinal = leads.filter((l) => sinal.testarAusencia(l) === false);
    // Leads sem o sinal (condição boa)
    const semSinal = leads.filter((l) => sinal.testarAusencia(l) === true);

    if (comSinal.length < 5 || semSinal.length < 5) {
      // Dados insuficientes para este sinal
      continue;
    }

    const taxaComSinal =
      comSinal.filter((l) => STATUSES_POSITIVOS.includes(l.status)).length / comSinal.length;
    const taxaSemSinal =
      semSinal.filter((l) => STATUSES_POSITIVOS.includes(l.status)).length / semSinal.length;

    const pesoSugerido = calcularNovoPeso(sinal.pesoAtual, taxaComSinal, taxaSemSinal);

    let justificativa: string;
    if (pesoSugerido === sinal.pesoAtual) {
      justificativa = `Peso mantido. Taxa geral: ${(taxaGeral * 100).toFixed(1)}%. Com sinal: ${(taxaComSinal * 100).toFixed(1)}% | Sem sinal: ${(taxaSemSinal * 100).toFixed(1)}%.`;
    } else if (pesoSugerido > sinal.pesoAtual) {
      justificativa = `Aumentar peso: leads com "${sinal.label}" convertem ${(taxaComSinal * 100).toFixed(1)}% vs ${(taxaSemSinal * 100).toFixed(1)}% — sinal forte de oportunidade.`;
    } else {
      justificativa = `Reduzir peso: diferença de conversão entre leads com/sem "${sinal.label}" é pequena (${(taxaComSinal * 100).toFixed(1)}% vs ${(taxaSemSinal * 100).toFixed(1)}%) — sinal tem baixo poder preditivo.`;
    }

    sugestoes.push({
      sinal: sinal.chave,
      pesoAtual: sinal.pesoAtual,
      pesoSugerido,
      taxaComSinal,
      taxaSemSinal,
      justificativa,
    });
  }

  return sugestoes;
}
