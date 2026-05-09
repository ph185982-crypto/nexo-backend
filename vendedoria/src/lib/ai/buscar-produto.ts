import { prisma } from '@/lib/prisma/client';

export interface DadosProduto {
  id: string;
  nome: string;
  preco: number;
  slug: string;
}

export async function buscarPrecoProduto(
  nomeProduto: string
): Promise<DadosProduto | null> {
  const produto = await prisma.produto.findFirst({
    where: {
      OR: [
        { nome: { contains: nomeProduto, mode: 'insensitive' } },
        { slug: { contains: nomeProduto.toLowerCase().replace(/\s+/g, '-') } },
      ],
      ativo: true,
      ehFerramenta: true,
    },
    select: {
      id: true,
      nome: true,
      precoDesconto: true,
      precoVenda: true,
      slug: true,
    },
  });

  if (!produto) {
    console.error(`[PRODUTO] Não encontrado: ${nomeProduto}`);
    return null;
  }

  return {
    id: produto.id,
    nome: produto.nome,
    preco: produto.precoDesconto ?? produto.precoVenda,
    slug: produto.slug,
  };
}
