import { prisma } from "@/lib/prisma/client";

export interface ProdutoSelecionado {
  id: string;
  nome: string;
  precoCusto: number;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoUrl: string;
  vezesUsadoEmOferta: number;
  ultimaOfertaEm: Date | null;
}

/**
 * Selects the next product to feature in an offer, applying rotation rules:
 *
 * 1. Never use the same product that was already sent TODAY.
 * 2. Prioritize products never used (vezesUsadoEmOferta === 0).
 * 3. Among unused, pick at random.
 * 4. If all were used, prioritize least recently used.
 * 5. If all were used today — allow repeat (rare edge case with very few products).
 */
export async function selecionarProduto(): Promise<ProdutoSelecionado | null> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Fetch all active ferramentas
  const todos = await prisma.produto.findMany({
    where: { ativo: true, ehFerramenta: true },
    select: {
      id: true,
      nome: true,
      precoCusto: true,
      precoVenda: true,
      precoDesconto: true,
      parcelamento: true,
      fotoUrl: true,
      vezesUsadoEmOferta: true,
      ultimaOfertaEm: true,
    },
    orderBy: { vezesUsadoEmOferta: "asc" },
  });

  if (todos.length === 0) return null;

  // Exclude products already sent TODAY
  const naoUsadosHoje = todos.filter(
    (p) => !p.ultimaOfertaEm || p.ultimaOfertaEm < startOfDay
  );

  const candidatos = naoUsadosHoje.length > 0 ? naoUsadosHoje : todos;

  // Prefer products never used in any offer
  const nunca = candidatos.filter((p) => p.vezesUsadoEmOferta === 0);
  if (nunca.length > 0) {
    return nunca[Math.floor(Math.random() * nunca.length)];
  }

  // Among used, pick least recently used (already sorted asc by vezesUsadoEmOferta)
  // Among those with same count, sort by ultimaOfertaEm ascending (oldest first)
  const sorted = [...candidatos].sort((a, b) => {
    if (a.vezesUsadoEmOferta !== b.vezesUsadoEmOferta) {
      return a.vezesUsadoEmOferta - b.vezesUsadoEmOferta;
    }
    const aTime = a.ultimaOfertaEm?.getTime() ?? 0;
    const bTime = b.ultimaOfertaEm?.getTime() ?? 0;
    return aTime - bTime;
  });

  // Take all products with the minimum count and pick randomly
  const minCount = sorted[0].vezesUsadoEmOferta;
  const minGroup = sorted.filter((p) => p.vezesUsadoEmOferta === minCount);
  return minGroup[Math.floor(Math.random() * minGroup.length)];
}
