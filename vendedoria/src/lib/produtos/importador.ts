import { prisma } from "@/lib/prisma/client";
import { scrapeFornecedor, processarProdutosManuais, ProdutoFornecedor } from "@/lib/scraper/fornecedor";

function toSlug(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export interface ImportResult {
  total: number;
  novos: number;
  atualizados: number;
  ignorados: number;
  produtos: Array<{ id: string; nome: string; acao: "novo" | "atualizado" | "ignorado" }>;
}

async function upsertProdutos(items: ProdutoFornecedor[]): Promise<ImportResult> {
  const result: ImportResult = {
    total: items.length,
    novos: 0,
    atualizados: 0,
    ignorados: 0,
    produtos: [],
  };

  // Load existing slugs to avoid collision
  const existingSlugs = await prisma.produto.findMany({ select: { slug: true } });
  const slugSet = new Set(existingSlugs.map((p) => p.slug));

  for (const item of items) {
    const baseSlug = toSlug(item.nome);
    const existing = await prisma.produto.findFirst({
      where: { nome: item.nome },
      select: { id: true, slug: true },
    });

    if (existing) {
      await prisma.produto.update({
        where: { id: existing.id },
        data: {
          precoCusto: item.precoCusto,
          precoVenda: item.precoVenda,
          precoDesconto: item.precoDesconto,
          parcelamento: item.parcelamento,
          fotoUrl: item.fotoUrl || existing.id, // keep old if no new URL
          descricao: item.descricao,
          categoria: item.categoria,
          ativo: true,
          atualizadoEm: new Date(),
        },
      });
      result.atualizados++;
      result.produtos.push({ id: existing.id, nome: item.nome, acao: "atualizado" });
    } else {
      const slug = uniqueSlug(baseSlug, slugSet);
      slugSet.add(slug);
      const novo = await prisma.produto.create({
        data: {
          nome: item.nome,
          slug,
          precoCusto: item.precoCusto,
          precoVenda: item.precoVenda,
          precoDesconto: item.precoDesconto,
          parcelamento: item.parcelamento,
          fotoUrl: item.fotoUrl,
          descricao: item.descricao,
          categoria: item.categoria ?? "ferramenta",
          ativo: true,
          ehFerramenta: item.ehFerramenta,
        },
      });
      result.novos++;
      result.produtos.push({ id: novo.id, nome: item.nome, acao: "novo" });
    }
  }

  return result;
}

export async function importarDoFornecedor(url?: string): Promise<ImportResult> {
  const items = await scrapeFornecedor(url);
  if (items.length === 0) {
    return { total: 0, novos: 0, atualizados: 0, ignorados: 0, produtos: [] };
  }
  return upsertProdutos(items);
}

export async function importarManual(
  items: Array<{ nome: string; preco: number; fotoUrl?: string; categoria?: string; descricao?: string }>
): Promise<ImportResult> {
  const produtos = processarProdutosManuais(items);
  return upsertProdutos(produtos);
}
