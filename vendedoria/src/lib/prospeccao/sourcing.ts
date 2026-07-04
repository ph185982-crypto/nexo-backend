// Sourcing de leads via:
//   1. RapidAPI Local Business Data (primário — dados do Google Maps)
//   2. Receita Federal via RapidAPI lista-de-empresas-por-segmento (escala B2B)
//   3. Google Places Text Search API (fallback)
// Env vars: RAPIDAPI_KEY | GOOGLE_PLACES_API_KEY

import { prisma } from "@/lib/prisma/client";

const PLACES_API = "https://places.googleapis.com/v1/places:searchText";
const RAPIDAPI_HOST = "local-business-data.p.rapidapi.com";
const RF_API_HOST   = "lista-de-empresas-por-segmento.p.rapidapi.com";

// ── Chave RapidAPI: banco (IntegrationCredential provider "RAPIDAPI") → env ──
// Mesmo padrão do token Meta (WhatsappProviderConfig.accessToken ?? env) e do
// cache de credenciais do Google Calendar.

let rapidKeyCache: string | null | undefined;
let rapidKeyCacheAt = 0;
const RAPID_KEY_CACHE_TTL_MS = 60_000;

export async function getRapidApiKey(): Promise<string | null> {
  const now = Date.now();
  if (rapidKeyCache !== undefined && now - rapidKeyCacheAt < RAPID_KEY_CACHE_TTL_MS) {
    return rapidKeyCache ?? process.env.RAPIDAPI_KEY ?? null;
  }
  try {
    const cred = await prisma.integrationCredential.findUnique({
      where: { provider: "RAPIDAPI" },
      select: { refreshToken: true },
    });
    rapidKeyCache = cred?.refreshToken ?? null;
  } catch {
    rapidKeyCache = null;
  }
  rapidKeyCacheAt = now;
  return rapidKeyCache ?? process.env.RAPIDAPI_KEY ?? null;
}

/** Invalida o cache (chamar após salvar a chave pela UI/API). */
export function invalidateRapidApiKeyCache(): void {
  rapidKeyCache = undefined;
  rapidKeyCacheAt = 0;
}

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

// ── Receita Federal via RapidAPI ──────────────────────────────────────────────

interface RFBusiness {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  situacao_cadastral?: string | number;
}

interface RFResponse {
  status?: string;
  data?: RFBusiness[];
  empresas?: RFBusiness[];
  results?: RFBusiness[];
}

async function buscarNoRapidAPI(
  query: string,
  cidade: string,
): Promise<PlaceResult[]> {
  const apiKey = await getRapidApiKey();
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

async function buscarNoReceitaFederal(
  _query: string,
  cidade: string,
): Promise<PlaceResult[]> {
  const apiKey = await getRapidApiKey();
  if (!apiKey) return [];

  // Normaliza: remove acentos, uppercase, sem parênteses (ex: "Aparecida de Goiânia" → "APARECIDA DE GOIANIA")
  const cidadeNorm = cidade
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();

  try {
    const params = new URLSearchParams({
      campo:    "municipio",
      q:        cidadeNorm,
      situacao: "Ativa",
    });

    const res = await fetch(
      `https://${RF_API_HOST}/buscar-por-segmento.php?${params}`,
      {
        headers: {
          "Content-Type":    "application/json",
          "x-rapidapi-host": RF_API_HOST,
          "x-rapidapi-key":  apiKey,
        },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Sourcing] ReceitaFederal ${res.status}:`, err.substring(0, 200));
      return [];
    }

    const data = await res.json() as RFResponse;
    // A API pode retornar os dados em campos diferentes dependendo da versão
    const businesses: RFBusiness[] = data.data ?? data.empresas ?? data.results ?? [];
    console.log(`[Sourcing] ReceitaFederal "${cidadeNorm}": ${businesses.length} empresas ativas`);

    return businesses
      .filter((b) => b.cnpj) // descarta entradas sem CNPJ
      .map((b): PlaceResult => {
        const ddd = b.ddd_telefone_1 ?? b.ddd_telefone_2;
        // Monta telefone em E.164 a partir do DDD+número
        const telDigits = ddd ? `+55${ddd.replace(/\D/g, "")}` : undefined;

        const endParts = [b.logradouro, b.numero, b.bairro, b.municipio, b.uf, b.cep]
          .filter(Boolean);

        return {
          // Prefixo "cnpj:" garante que nunca colide com Google place_id
          id:          `cnpj:${b.cnpj!.replace(/\D/g, "")}`,
          displayName: (b.nome_fantasia || b.razao_social)
            ? { text: (b.nome_fantasia || b.razao_social)! }
            : undefined,
          formattedAddress:       endParts.length > 0 ? endParts.join(", ") : undefined,
          internationalPhoneNumber: telDigits,
          websiteUri:             undefined, // RF não tem website
          rating:                 undefined,
          userRatingCount:        undefined,
        };
      });
  } catch (e) {
    console.error("[Sourcing] Erro ReceitaFederal:", e);
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
 * Busca empresas combinando todas as fontes disponíveis:
 *   1. RapidAPI Local Business Data (Google Maps via RapidAPI) — primária
 *   2. Receita Federal via RapidAPI (escala B2B) — paralela se RAPIDAPI_KEY presente
 *   3. Google Places Text Search — fallback se nenhuma chave RapidAPI
 *
 * Dedupe ocorre no chamador (buscarLeadsPorSegmento) via placeId no banco.
 */
async function buscarEmpresas(termo: string, cidade: string): Promise<PlaceResult[]> {
  const temRapid  = Boolean(await getRapidApiKey());
  const temGoogle = Boolean(process.env.GOOGLE_PLACES_API_KEY);

  if (temRapid) {
    // Roda RapidAPI Local Business Data e Receita Federal em paralelo
    const [rapidResults, rfResults] = await Promise.all([
      buscarNoRapidAPI(termo, cidade),
      buscarNoReceitaFederal(termo, cidade),
    ]);

    const combined = [...rapidResults, ...rfResults];

    if (combined.length > 0) return combined;

    // Se ambas retornaram vazio e tem Google Places, tenta como fallback
    if (temGoogle) return buscarNoGooglePlaces(termo, cidade);
    return [];
  }

  return buscarNoGooglePlaces(termo, cidade);
}

export async function buscarLeadsPorSegmento(segmentId: string): Promise<{
  inseridos: number;
  ignorados: number;
  erros: number;
}> {
  const rapidKey = await getRapidApiKey();
  if (!rapidKey && !process.env.GOOGLE_PLACES_API_KEY) {
    throw new Error(
      "Nenhuma fonte de busca configurada: adicione sua chave RapidAPI em Configurações > Integrações",
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
