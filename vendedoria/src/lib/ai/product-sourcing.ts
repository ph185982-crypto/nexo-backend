import { prisma } from "@/lib/prisma/client";

export interface ProductContext {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: number;
  priceInstallments?: number | null;
  installments: number;
  imageUrl?: string | null;
  imageUrls: string[];
  videoUrl?: string | null;
  category?: string | null;
}

function toSlug(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export class ProductSourcingService {
  async detectAndFetch(message: string, organizationId: string): Promise<ProductContext[]> {
    const products = await prisma.product.findMany({
      where: { organizationId, isActive: true },
    });

    const msg = normalize(message);

    const matched = products.filter((p) => {
      const nameLower = normalize(p.name);
      if (msg.includes(nameLower)) return true;

      if (p.category) {
        const cat = normalize(p.category);
        if (msg.includes(cat)) return true;
      }

      // Word-by-word match (3+ char words from product name)
      const words = nameLower.split(/\s+/).filter((w) => w.length >= 3);
      return words.some((w) => msg.includes(w));
    });

    return matched.map((p) => ({
      id: p.id,
      name: p.name,
      slug: toSlug(p.name),
      description: p.description,
      price: p.price,
      priceInstallments: p.priceInstallments,
      installments: p.installments,
      imageUrl: p.imageUrl,
      imageUrls: Array.isArray(p.imageUrls) ? (p.imageUrls as string[]) : [],
      videoUrl: p.videoUrl,
      category: p.category,
    }));
  }

  buildCatalogLayer(products: ProductContext[]): string {
    if (!products.length) return "";

    const blocks = products.map((p) => {
      const price = `R$ ${p.price.toFixed(2).replace(".", ",")}`;
      const installStr =
        p.priceInstallments && p.priceInstallments > 0
          ? `${p.installments}x de R$ ${p.priceInstallments.toFixed(2).replace(".", ",")}`
          : "";

      const hasImgs = p.imageUrls.length > 0 || !!p.imageUrl;

      return [
        `📦 PRODUTO: ${p.name}`,
        `💰 À vista: ${price}`,
        installStr ? `💳 Parcelado: ${installStr}` : "",
        p.description ? `📝 ${p.description.slice(0, 180)}` : "",
        hasImgs ? `[Fotos: use [FOTO_${p.slug}] em balão separado]` : "",
        p.videoUrl ? `[Vídeo: use [VIDEO_${p.slug}] em balão separado]` : "",
        `⚠️ CRÍTICO: use EXATAMENTE este preço. NUNCA invente valores.`,
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      `--- CATÁLOGO REAL (BANCO DE DADOS — USE ESTES DADOS EXATOS) ---`,
      ...blocks,
      `--- FIM CATÁLOGO ---`,
    ].join("\n\n");
  }
}

export const productSourcingService = new ProductSourcingService();
