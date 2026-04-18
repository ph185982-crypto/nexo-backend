import puppeteer from "puppeteer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProdutoFornecedor {
  nome: string;
  precoCusto: number;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoUrl: string;
  descricao?: string;
  categoria?: string;
  disponivel: boolean;
  ehFerramenta: boolean;
}

// ── Classificador ─────────────────────────────────────────────────────────────

export function ehFerramenta(nome: string, categoria: string): boolean {
  const palavras = [
    "chave", "furadeira", "parafusadeira", "impacto", "esmerilhadeira",
    "lixadeira", "serra", "martelo", "alicate", "kit", "compressor",
    "soldador", "torno", "mandril", "broca", "ponteira", "soquete",
    "catraca", "torquímetro", "multímetro", "nível", "trena",
    "ferramenta", "bateria", "carregador", "maleta", "jogo", "chaves",
    "politriz", "plaina", "soprador", "aspirador", "lavadora",
    "maquita", "tupia", "retifica", "morsa", "parafuso", "rebarbadora",
    "makita", "bosch", "dewalt", "tramontina", "vonder",
  ];
  const texto = (nome + " " + categoria).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return palavras.some((p) => texto.includes(p.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

// ── Cálculo de preços (margem de 75% sobre o custo) ──────────────────────────

export function calcularPrecos(precoCusto: number, margemPercent = 75) {
  const precoVenda   = Math.round(precoCusto * (1 + margemPercent / 100) * 100) / 100;
  const precoDesconto = precoVenda;
  const parcelamento  = Math.round((precoVenda / 10) * 100) / 100;
  return { precoVenda, precoDesconto, parcelamento };
}

// ── Raw product type extracted from page ─────────────────────────────────────

interface RawProduct {
  nome: string;
  preco: number;
  fotoUrl: string;
  categoria: string;
  descricao: string;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export async function scrapeFornecedor(
  url = "https://yanne.vendizap.com/"
): Promise<ProdutoFornecedor[]> {
  console.log(`[Scraper] Iniciando scraping de ${url}`);

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for Vue store to be populated with products
    // VendiZap uses Vuex: state.produto.listaProdutosGaleria / listaProdutosDestaque
    const gotProducts = await page.waitForFunction(
      () => {
        const app = document.querySelector("#app") as HTMLElement & {
          __vue__?: { $store?: { state?: Record<string, unknown> } };
          __vue_app__?: { config?: { globalProperties?: { $store?: { state?: Record<string, unknown> } } } };
        };
        const storeState = (
          app?.__vue__?.$store?.state ??
          app?.__vue_app__?.config?.globalProperties?.$store?.state
        ) as Record<string, Record<string, unknown[]>> | undefined;
        if (!storeState) return false;
        const mod = storeState.produto as Record<string, unknown[]> | undefined;
        if (!mod) return false;
        return (
          (Array.isArray(mod.listaProdutosGaleria) && mod.listaProdutosGaleria.length > 0) ||
          (Array.isArray(mod.listaProdutosDestaque) && mod.listaProdutosDestaque.length > 0) ||
          (Array.isArray(mod.listaProdutosMaisVendidos) && mod.listaProdutosMaisVendidos.length > 0)
        );
      },
      { timeout: 30000 }
    ).catch(() => false);

    if (!gotProducts) {
      console.log("[Scraper] Vue store não populou em 30s — tentando DOM fallback...");
    }

    // Extra scroll to trigger lazy-load
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, 600);
        await new Promise((r) => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 2000));

    const rawProducts = await page.evaluate((): { products: RawProduct[]; debug: string } => {
      const app = document.querySelector("#app") as HTMLElement & {
        __vue__?: { $store?: { state?: Record<string, unknown> } };
        __vue_app__?: { config?: { globalProperties?: { $store?: { state?: Record<string, unknown> } } } };
      };

      const storeState = (
        app?.__vue__?.$store?.state ??
        app?.__vue_app__?.config?.globalProperties?.$store?.state
      ) as Record<string, Record<string, unknown[]>> | undefined;

      // Try Vuex store product lists (VendiZap-specific paths)
      if (storeState) {
        const prodMod = storeState.produto as Record<string, unknown[]> | undefined;
        if (prodMod) {
          const lists = [
            prodMod.listaProdutosGaleria ?? [],
            prodMod.listaProdutosDestaque ?? [],
            prodMod.listaProdutosMaisVendidos ?? [],
            prodMod.listaProdutosPromocoes ?? [],
          ].flat() as Array<Record<string, unknown>>;

          const seen = new Set<string>();
          const products: RawProduct[] = [];
          for (const p of lists) {
            const id = String(p.id ?? p.idProduto ?? p.titulo ?? p.nome ?? Math.random());
            if (seen.has(id)) continue;
            seen.add(id);
            const nome = String(p.titulo ?? p.nome ?? p.name ?? "");
            const preco = Number(p.preco ?? p.precoVenda ?? p.valor ?? p.price ?? 0);
            const fotoUrl = String(
              (Array.isArray(p.fotos) ? p.fotos[0] : undefined) ??
              p.fotoUrl ?? p.foto ?? p.imagem ?? p.imageUrl ?? ""
            );
            const categoria = String(p.categoria ?? p.category ?? "");
            const descricao = String(p.descricao ?? p.description ?? "");
            if (nome && preco > 0) {
              products.push({ nome, preco, fotoUrl, categoria, descricao });
            }
          }
          if (products.length > 0) {
            return { products, debug: `Vuex store: ${products.length} produtos` };
          }
        }

        // Try global module as fallback
        const globalMod = storeState.global as Record<string, unknown[]> | undefined;
        if (globalMod) {
          const prods = (globalMod.produtos ?? globalMod.Produtos ?? []) as Array<Record<string, unknown>>;
          const products: RawProduct[] = prods.map((p) => ({
            nome: String(p.nome ?? p.name ?? ""),
            preco: Number(p.preco ?? p.precoVenda ?? p.valor ?? 0),
            fotoUrl: String((Array.isArray(p.fotos) ? p.fotos[0] : undefined) ?? p.fotoUrl ?? p.foto ?? ""),
            categoria: String(p.categoria ?? ""),
            descricao: String(p.descricao ?? ""),
          })).filter((p) => p.nome && p.preco > 0);
          if (products.length > 0) {
            return { products, debug: `Vuex global: ${products.length} produtos` };
          }
        }
      }

      // DOM fallback: try any product card selectors
      const selectors = [
        ".produto-card", ".card-produto", "[class*='produto']",
        "[class*='product']", ".v-card", "[data-produto]",
        "article", ".item",
      ];
      for (const sel of selectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length < 2) continue;
        const products: RawProduct[] = [];
        cards.forEach((card) => {
          const nome = (
            card.querySelector(".nome-produto, .product-name, h3, h4, .title, [class*='nome'], [class*='titulo']")?.textContent ?? ""
          ).trim();
          const precoText = card.querySelector(
            ".preco, .price, .valor, [class*='preco'], [class*='price'], [class*='valor']"
          )?.textContent ?? "";
          const img = card.querySelector("img") as HTMLImageElement | null;
          const fotoUrl = img?.src ?? img?.getAttribute("data-src") ?? "";
          const precoMatch = precoText.match(/[\d.,]+/);
          const preco = precoMatch ? parseFloat(precoMatch[0].replace(/\./g, "").replace(",", ".")) : 0;
          if (nome && preco > 0) {
            products.push({ nome, preco, fotoUrl, categoria: "", descricao: "" });
          }
        });
        if (products.length > 0) {
          return { products, debug: `DOM (${sel}): ${products.length} produtos` };
        }
      }

      return { products: [], debug: document.body.innerText.substring(0, 500) };
    });

    console.log(`[Scraper] ${rawProducts.debug}`);

    if (rawProducts.products.length === 0) {
      console.log("[Scraper] Nenhum produto encontrado.");
      return [];
    }

    const result: ProdutoFornecedor[] = rawProducts.products.map((p) => {
      const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(p.preco);
      return {
        nome: p.nome,
        precoCusto: p.preco,
        precoVenda,
        precoDesconto,
        parcelamento,
        fotoUrl: p.fotoUrl,
        descricao: p.descricao,
        categoria: p.categoria,
        disponivel: true,
        ehFerramenta: ehFerramenta(p.nome, p.categoria),
      };
    });

    const ferramentas = result.filter((p) => p.ehFerramenta);
    console.log(`[Scraper] ${result.length} produtos → ${ferramentas.length} identificados como ferramentas`);
    // Return ALL products from the supplier URL (supplier is a dedicated tool store)
    return result;
  } finally {
    await browser.close();
  }
}

// ── Importação manual (JSON) ──────────────────────────────────────────────────

export function processarProdutosManuais(
  items: Array<{ nome: string; preco: number; fotoUrl?: string; categoria?: string; descricao?: string }>
): ProdutoFornecedor[] {
  return items
    .map((item) => {
      const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(item.preco);
      return {
        nome: item.nome,
        precoCusto: item.preco,
        precoVenda,
        precoDesconto,
        parcelamento,
        fotoUrl: item.fotoUrl ?? "",
        descricao: item.descricao,
        categoria: item.categoria ?? "ferramenta",
        disponivel: true,
        ehFerramenta: ehFerramenta(item.nome, item.categoria ?? "ferramenta"),
      };
    })
    .filter((p) => p.nome && p.precoCusto > 0);
}
