import { prisma } from "@/lib/prisma/client";

export interface ProdutoContexto {
  id: string;
  nome: string;
  slug: string;
  preco: number;
  precoParcelado?: number | null;
  parcelas?: number;
  descricao?: string;
  especificacoes?: string;
  flagFoto: string;
  flagVideo: string;
  temFoto: boolean;
  temVideo: boolean;
}

function slugFromName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export async function buscarProdutosAtivos(organizationId: string): Promise<ProdutoContexto[]> {
  const produtos = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      price: true,
      priceInstallments: true,
      installments: true,
      description: true,
      especificacoes: true,
      imageUrl: true,
      imageUrls: true,
      videoUrl: true,
    },
  });

  return produtos.map((p) => {
    const s = slugFromName(p.name);
    return {
      id: p.id,
      nome: p.name,
      slug: s,
      preco: p.price,
      precoParcelado: p.priceInstallments,
      parcelas: p.installments,
      descricao: p.description ?? undefined,
      especificacoes: p.especificacoes ?? undefined,
      flagFoto: `[FOTO_${s}]`,
      flagVideo: `[VIDEO_${s}]`,
      temFoto: !!(p.imageUrl || (Array.isArray(p.imageUrls) && p.imageUrls.length > 0)),
      temVideo: !!p.videoUrl,
    };
  });
}

export async function buscarProdutoPorMensagem(
  mensagem: string,
  organizationId: string,
): Promise<ProdutoContexto | null> {
  const produtos = await buscarProdutosAtivos(organizationId);
  const texto = mensagem.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  for (const produto of produtos) {
    const nomeLower = produto.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const palavras = nomeLower.split(/\s+/).filter((w) => w.length > 3);

    if (
      texto.includes(nomeLower) ||
      palavras.some((w) => texto.includes(w))
    ) {
      return produto;
    }
  }

  return null;
}

export function formatarProdutosParaContexto(produtos: ProdutoContexto[]): string {
  if (!produtos.length) return "Nenhum produto ativo cadastrado.";

  return produtos
    .map((p) => {
      const linhas = [
        `PRODUTO: ${p.nome}`,
        `PREÇO: R$ ${p.preco.toFixed(2)}`,
      ];
      if (p.precoParcelado && p.parcelas) {
        linhas.push(`PARCELAMENTO: ${p.parcelas}x de R$ ${p.precoParcelado.toFixed(2)} sem juros`);
      }
      if (p.descricao) linhas.push(`DESCRIÇÃO: ${p.descricao}`);
      if (p.especificacoes) linhas.push(`ESPECIFICAÇÕES: ${p.especificacoes}`);
      if (p.temFoto) linhas.push(`FLAG_FOTO: ${p.flagFoto}`);
      if (p.temVideo) linhas.push(`FLAG_VIDEO: ${p.flagVideo}`);
      return linhas.join("\n");
    })
    .join("\n---\n");
}
