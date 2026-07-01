// Cálculo de score de qualificação baseado nos pesos do segmento

import { prisma } from "@/lib/prisma/client";

export async function calcularScore(leadId: string): Promise<number> {
  const lead = await prisma.prospectLead.findUnique({
    where: { id: leadId },
    include: { segment: true },
  });

  if (!lead) throw new Error(`ProspectLead ${leadId} não encontrado`);

  const seg = lead.segment;
  if (!seg) {
    // Sem segmento — usa pesos padrão
    const score = calcularScoreComPesos(lead, {
      pesoSemSite:          3,
      pesoSemAnuncioAtivo:  2,
      pesoInstagramParado:  1,
      pesoRatingBaixo:      1,
    });
    await prisma.prospectLead.update({
      where: { id: leadId },
      data: { score, status: "PONTUADO" },
    });
    return score;
  }

  const score = calcularScoreComPesos(lead, seg);

  await prisma.prospectLead.update({
    where: { id: leadId },
    data: { score, status: "PONTUADO" },
  });

  console.log(`[Score] Lead ${leadId} "${lead.nome}" — score=${score}`);
  return score;
}

function calcularScoreComPesos(
  lead: {
    temSite: boolean | null;
    temAnuncioAtivo: boolean | null;
    instagramAtivo: boolean | null;
    ratingGoogle: number | null;
  },
  pesos: {
    pesoSemSite: number;
    pesoSemAnuncioAtivo: number;
    pesoInstagramParado: number;
    pesoRatingBaixo: number;
  },
): number {
  let score = 0;

  // Ponto se não tem site (oportunidade de criar/melhorar presença digital)
  if (lead.temSite === false) score += pesos.pesoSemSite;

  // Ponto se não tem anúncio ativo (oportunidade de tráfego pago)
  if (lead.temAnuncioAtivo === false) score += pesos.pesoSemAnuncioAtivo;

  // Ponto se Instagram parado ou ausente
  if (lead.instagramAtivo === false || lead.instagramAtivo === null) {
    score += pesos.pesoInstagramParado;
  }

  // Ponto se rating baixo (< 4.0 — pode estar perdendo clientes)
  if (lead.ratingGoogle !== null && lead.ratingGoogle < 4.0) {
    score += pesos.pesoRatingBaixo;
  }

  return score;
}

export async function calcularScoreLote(segmentId: string): Promise<{
  processados: number;
  erros: number;
}> {
  const leads = await prisma.prospectLead.findMany({
    where: { segmentId, status: "ENRIQUECIDO" },
    select: { id: true },
    take: 100,
  });

  let processados = 0;
  let erros = 0;

  for (const lead of leads) {
    try {
      await calcularScore(lead.id);
      processados++;
    } catch (e) {
      console.error(`[Score] Erro no lead ${lead.id}:`, e);
      erros++;
    }
  }

  return { processados, erros };
}
