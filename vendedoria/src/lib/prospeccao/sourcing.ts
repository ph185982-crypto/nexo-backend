// Sourcing de leads via RapidAPI Local Business Data (primário) ou
// Google Places Text Search API (fallback).
// Env vars: RAPIDAPI_KEY | GOOGLE_PLACES_API_KEY

import { prisma } from "@/lib/prisma/client";

const PLACES_API = "https://places.googleapis.com/v1/places:searchText";
const RAPIDAPI_HOST = "local-business-data.p.rapidapi.com";

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

interface RapidApiBusiness {
  place_id?: string;
  business_id?: string;
  name?: string;
  full_address?: string;
  phone_number?: string;
  website?: string;
  rating?: number;
  review_count?: number;
  business_status?: string; // OPEN | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
}

interface RapidApiResponse {
  status?: string;
  data?: RapidApiBusiness[];
}

async function buscarNoRapidAPI(
  query: string,
  cidade: string,
): Promise<PlaceResult[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      query: `${query} em ${cidade}`,
      limit: "20",
      region: "br",
      language: "pt",
    });
    const res = await fetch(`https://${RAPIDAPI_HOST}/search?${params}`, {
      headers: {
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": apiKey,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Sourcing] RapidAPI ${res.status}:`, err.substring(0, 200));
      return [];
    }

    const data = await res.json() as RapidApiResponse;
    const businesses = (data.data ?? []).filter(
      (b) => b.business_status !== "CLOSED_PERMANENTLY",
    );

    // Mapeia para o mesmo shape do Google Places (place_id é o mesmo formato)
    return businesses.map((b): PlaceResult => ({
      id: b.place_id ?? b.business_id ?? "",
      displayName: b.name ? { text: b.name } : undefined,
      formattedAddress: b.full_address,
      internationalPhoneNumber: b.phone_number,
      websiteUri: b.website,
      rating: b.rating,
      userRatingCount: b.review_count,
    }));
  } catch (e) {
    console.error("[Sourcing] Erro RapidAPI:", e);
    return [];
  }
}

async function buscarNoGooglePlaces(
  query: string,
  cidade: string,
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

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

/**
 * Detecta se um telefone brasileiro é FIXO ou CELULAR.
 * Celular: 11 dígitos (DDD + 9 + 8 dígitos), com "9" logo após o DDD.
 * Fixo: 10 dígitos (DDD + 8 dígitos iniciando em 2-5).
 */
export function detectarTipoTelefoneBR(raw: string | null): "FIXO" | "CELULAR" | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") return "CELULAR";
  if (d.length === 10) return "FIXO";
  return null;
}

/**
 * Busca empresas usando a fonte disponível: RapidAPI (primária) ou
 * Google Places (fallback). Se a primária retornar vazio e a outra
 * chave existir, tenta a secundária.
 */
async function buscarEmpresas(termo: string, cidade: string): Promise<PlaceResult[]> {
  const temRapid = Boolean(process.env.RAPIDAPI_KEY);
  const temGoogle = Boolean(process.env.GOOGLE_PLACES_API_KEY);

  if (temRapid) {
    const places = await buscarNoRapidAPI(termo, cidade);
    if (places.length > 0 || !temGoogle) return places;
    return buscarNoGooglePlaces(termo, cidade);
  }
  return buscarNoGooglePlaces(termo, cidade);
}

export async function buscarLeadsPorSegmento(segmentId: string): Promise<{
  inseridos: number;
  ignorados: number;
  erros: number;
}> {
  if (!process.env.RAPIDAPI_KEY && !process.env.GOOGLE_PLACES_API_KEY) {
    throw new Error(
      "Nenhuma fonte de busca configurada: defina RAPIDAPI_KEY (ou GOOGLE_PLACES_API_KEY) no servidor",
    );
  }

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
      const places = await buscarEmpresas(termo, cidade);

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
          const tipoTelefone = detectarTipoTelefoneBR(telefone);

          // Filtros do segmento
          if (segment.apenasCelular && tipoTelefone !== "CELULAR") {
            result.ignorados++;
            continue;
          }
          if (segment.filtroSite === "SEM_SITE" && place.websiteUri) {
            result.ignorados++;
            continue;
          }
          if (segment.filtroSite === "COM_SITE" && !place.websiteUri) {
            result.ignorados++;
            continue;
          }

          await prisma.prospectLead.create({
            data: {
              organizationId: segment.organizationId,
              segmentId:      segment.id,
              placeId:        place.id,
              nome:           place.displayName?.text ?? null,
              telefone,
              tipoTelefone,
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
