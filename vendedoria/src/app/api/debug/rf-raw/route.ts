import { NextResponse } from "next/server";
import { getRapidApiKey } from "@/lib/prospeccao/sourcing";

/**
 * TEMPORARY — inspeciona a resposta CRUA (sem mapear pra PlaceResult) da API
 * "lista-de-empresas-por-segmento" pra descobrir se ela já retorna CNAE por
 * empresa (pra filtrar no nosso lado) e/ou se aceita algum parâmetro de
 * segmento que o código atual não está usando. Faz UMA chamada só, com
 * limite pequeno. DELETE após inspecionar.
 */
const RF_API_HOST = "lista-de-empresas-por-segmento.p.rapidapi.com";

export async function GET() {
  const apiKey = await getRapidApiKey();
  if (!apiKey) return NextResponse.json({ error: "sem RAPIDAPI_KEY" }, { status: 400 });

  const params = new URLSearchParams({
    campo: "municipio",
    q: "GOIANIA",
    situacao: "Ativa",
  });

  const res = await fetch(`https://${RF_API_HOST}/buscar-por-segmento.php?${params}`, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": RF_API_HOST,
      "x-rapidapi-key": apiKey,
    },
  });

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* mantém texto cru */ }

  const data = parsed as { data?: unknown[]; empresas?: unknown[]; results?: unknown[]; total?: number; count?: number } | null;
  const lista = data?.data ?? data?.empresas ?? data?.results ?? [];

  return NextResponse.json({
    httpStatus: res.status,
    totalDeclarado: data?.total ?? data?.count ?? null,
    quantidadeRetornada: Array.isArray(lista) ? lista.length : null,
    primeirasEmpresasCompletas: Array.isArray(lista) ? lista.slice(0, 5) : null,
    chavesDoObjeto: Array.isArray(lista) && lista[0] ? Object.keys(lista[0] as object) : null,
    respostaCrua: parsed ? undefined : text.slice(0, 500),
  });
}
