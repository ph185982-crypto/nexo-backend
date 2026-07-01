// Sourcing de leads via Google Places Text Search API
// Env var: GOOGLE_PLACES_API_KEY

import { prisma } from "@/lib/prisma/client";

const PLACES_API = "https://places.googleapis.com/v1/places:searchText";

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
}

interface PlacesResponse {
  places?: PlaceResult[];
}

async function buscarNoGooglePlaces(
  query: string,
  cidade: string,
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[Sourcing] GOOGLE_PLACES_API_KEY não configurado");
    return [];
  }

  try {
    const res = await fetch(PLACES_API, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "X-Goog-Api-Key":   apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery:       `${query} em ${cidade}`,
        languageCode:    "pt-BR",
        regionCode:      "BR",
        maxResultCount:  20,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Sourcing] Places API ${res.status}:`, err.substring(0, 200));
      return [];
    }

    const data = await res.json() as PlacesResponse;
    return data.places ?? [];
  } catch (e) {
    console.error("[Sourcing] Erro Places API:", e);
    return [];
  }
}

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  // Mantém formato limpo internacionalmente
  return raw.trim();
}

export async function buscarLeadsPorSegmento(segmentId: string): Promise<{
  inseridos: number;
  ignorados: number;
  erros: number;
}> {
  const segment = await prisma.prospectSegment.findUnique({
    where: { id: segmentId },
    include: { organization: { select: { id: true } } },
  });

  if (!segment || !segment.ativo) {
    throw new Error(`Segmento ${segmentId} não encontrado ou inativo`);
  }

  const termos = [segment.termoBusca, ...segment.termosSecundarios];
  const result = { inseridos: 0, ignorados: 0, erros: 0 };

  // Para cada combinação termo × cidade
  for (const termo of termos) {
    for (const cidade of segment.cidades) {
      console.log(`[Sourcing] Buscando "${termo}" em "${cidade}"...`);
      const places = await buscarNoGooglePlaces(termo, cidade);

      for (const place of places) {
        if (!place.id) continue;

        // Dedupe por placeId
        const exists = await prisma.prospectLead.findUnique({
          where: { placeId: place.id },
        });

        if (exists) {
          result.ignorados++;
          continue;
        }

        try {
          const telefone = normalizePhone(
            place.nationalPhoneNumber ?? place.internationalPhoneNumber,
          );

          await prisma.prospectLead.create({
            data: {
              organizationId: segment.organizationId,
              segmentId:      segment.id,
              placeId:        place.id,
              nome:           place.displayName?.text ?? null,
              telefone,
              enderecoCompleto: place.formattedAddress ?? null,
              website:          place.websiteUri       ?? null,
              ratingGoogle:     place.rating           ?? null,
              numeroAvaliacoes: place.userRatingCount  ?? null,
              status:           "NOVO",
            },
          });
          result.inseridos++;
        } catch (e) {
          console.error(`[Sourcing] Erro ao inserir placeId=${place.id}:`, e);
          result.erros++;
        }
      }

      // Rate limiting gentil entre chamadas
      await new Promise((r) => setTimeout(r, 300));
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[Sourcing] Segmento ${segmentId} — inseridos=${result.inseridos} ignorados=${result.ignorados} erros=${result.erros}`);
  return result;
}
