// Enriquecimento de ProspectLead com sinais digitais:
//   1. temSite — derivado do campo website do Places
//   2. temAnuncioAtivo — Meta Ad Library (público, sem token)
//   3. instagramAtivo / followersIG / ultimaPostagemIG — RapidAPI Instagram
//
// Env var: RAPIDAPI_KEY (para Instagram)

import { prisma } from "@/lib/prisma/client";
import { getRapidApiKey } from "@/lib/prospeccao/sourcing";

// ── Meta Ad Library — busca pública ───────────────────────────────────────────
// Endpoint público: https://www.facebook.com/ads/library/api/
// Não exige token de acesso

async function verificarAnuncioMeta(nomeNegocio: string): Promise<boolean | null> {
  try {
    const params = new URLSearchParams({
      ad_type:       "ALL",
      active_status: "ACTIVE",
      media_type:    "ALL",
      search_terms:  nomeNegocio,
      country:       "BR",
      fields:        "id,ad_creation_time",
      limit:         "1",
      ad_reached_countries: "BR",
    });

    const url = `https://graph.facebook.com/v19.0/ads_archive?${params.toString()}&access_token=`;
    // O Ad Library API exige token — mas o endpoint de busca pública via
    // facebook.com/ads/library não expõe JSON. Sem token, retornamos null.
    // Se META_AD_LIBRARY_TOKEN estiver configurado, usamos.
    const token = process.env.META_AD_LIBRARY_TOKEN;
    if (!token) {
      console.warn("[Enriquecimento] META_AD_LIBRARY_TOKEN não configurado — pulando verificação de anúncio");
      return null;
    }

    const res = await fetch(
      `https://graph.facebook.com/v19.0/ads_archive?${params.toString()}&access_token=${token}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (!res.ok) {
      console.warn(`[Enriquecimento] Ad Library ${res.status} para "${nomeNegocio}"`);
      return null;
    }

    const data = await res.json() as { data?: unknown[] };
    return (data.data?.length ?? 0) > 0;
  } catch (e) {
    console.error("[Enriquecimento] Erro Ad Library:", e);
    return null;
  }
}

// ── Instagram via RapidAPI (Instagram Scraper API) ─────────────────────────────
interface IGProfile {
  username?: string;
  full_name?: string;
  edge_followed_by?: { count: number };
  edge_owner_to_timeline_media?: { edges?: Array<{ node?: { taken_at_timestamp?: number } }> };
}

async function buscarInstagram(nomeNegocio: string): Promise<{
  ativo: boolean | null;
  followers: number | null;
  ultimaPostagem: Date | null;
} | null> {
  const rapidApiKey = await getRapidApiKey();
  if (!rapidApiKey) {
    console.warn("[Enriquecimento] Chave RapidAPI não configurada — pulando Instagram");
    return null;
  }

  // Normaliza nome para tentar como username
  const usernameGuess = nomeNegocio
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30);

  const endpoints = [
    `https://instagram-scraper-api2.p.rapidapi.com/v1/info?username_or_id_or_url=${encodeURIComponent(usernameGuess)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "X-RapidAPI-Key":  rapidApiKey,
          "X-RapidAPI-Host": "instagram-scraper-api2.p.rapidapi.com",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;

      const raw = await res.json() as { data?: IGProfile };
      const profile = raw.data;
      if (!profile?.username) return null;

      const followers = profile.edge_followed_by?.count ?? null;

      // Última postagem
      const edges = profile.edge_owner_to_timeline_media?.edges ?? [];
      const latestTs = edges[0]?.node?.taken_at_timestamp;
      const ultimaPostagem = latestTs ? new Date(latestTs * 1000) : null;

      // Considera ativo se postou nos últimos 90 dias
      const noventaDiasAtras = new Date(Date.now() - 90 * 24 * 60 * 60_000);
      const ativo = ultimaPostagem ? ultimaPostagem > noventaDiasAtras : edges.length > 0;

      return { ativo, followers, ultimaPostagem };
    } catch {
      continue;
    }
  }

  return null;
}

// ── Função principal ───────────────────────────────────────────────────────────

export async function enriquecerLead(leadId: string): Promise<void> {
  const lead = await prisma.prospectLead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`ProspectLead ${leadId} não encontrado`);

  const nomeNegocio = lead.nome ?? lead.telefone ?? "empresa";

  // 1. temSite — vem do website do Places (já populado no sourcing)
  const temSite = !!lead.website;

  // 2. temAnuncioAtivo — Meta Ad Library
  const temAnuncioAtivo = await verificarAnuncioMeta(nomeNegocio);

  // 3. Instagram
  const igData = await buscarInstagram(nomeNegocio);

  await prisma.prospectLead.update({
    where: { id: leadId },
    data: {
      temSite,
      temAnuncioAtivo:  temAnuncioAtivo,
      instagramAtivo:   igData?.ativo   ?? null,
      followersIG:      igData?.followers ?? null,
      ultimaPostagemIG: igData?.ultimaPostagem ?? null,
      status:           "ENRIQUECIDO",
    },
  });

  console.log(`[Enriquecimento] Lead ${leadId} "${nomeNegocio}" — site=${temSite} anuncio=${temAnuncioAtivo} ig=${igData?.ativo}`);
}

export async function enriquecerLote(segmentId: string): Promise<{
  processados: number;
  erros: number;
}> {
  const leads = await prisma.prospectLead.findMany({
    where: { segmentId, status: "NOVO" },
    select: { id: true, nome: true },
    take: 50,
  });

  let processados = 0;
  let erros = 0;

  for (const lead of leads) {
    try {
      await enriquecerLead(lead.id);
      processados++;
    } catch (e) {
      console.error(`[Enriquecimento] Erro no lead ${lead.id}:`, e);
      erros++;
    }
    // Rate limit entre chamadas
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { processados, erros };
}
