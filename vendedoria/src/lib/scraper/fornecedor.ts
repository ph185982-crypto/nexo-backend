import puppeteer from "puppeteer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProdutoFornecedor {
  nome: string;
  precoCusto: number;   // preco do fornecedor
  precoVenda: number;   // custo × 2
  precoDesconto: number; // venda × 0.75
  parcelamento: number; // desconto ÷ 10
  fotoUrl: string;
  descricao?: string;
  categoria?: string;
  disponivel: boolean;
  ehFerramenta: boolean;
}

// ── Classificador ─────────────────────────────────────────────────────────────

export function ehFerramenta(nome: string, categoria: string): boolean {
  const palavrasFerramenta = [
    "chave", "furadeira", "parafusadeira", "impacto", "esmerilhadeira",
    "lixadeira", "serra", "martelo", "alicate", "kit", "compressor",
    "soldador", "torno", "mandril", "broca", "ponteira", "soquete",
    "catraca", "torquímetro", "multímetro", "nível", "trena",
    "ferramenta", "bateria", "carregador", "maleta", "jogo", "chaves",
    "politriz", "plaina", "soprador", "aspirador", "lavadora",
    "maquita", "tupia", "retifica", "morsa",
  ];
  const texto = (nome + " " + categoria).toLowerCase();
  return palavrasFerramenta.some((p) => texto.includes(p));
}

// ── Cálculo de preços (margem de 75% sobre o custo) ──────────────────────────

export function calcularPrecos(precoCusto: number, margemPercent = 75) {
  // precoVenda = custo × (1 + margem/100)
  const precoVenda    = Math.round(precoCusto * (1 + margemPercent / 100) * 100) / 100;
  const precoDesconto = precoVenda;
  const parcelamento  = Math.round((precoVenda / 10) * 100) / 100;
  return { precoVenda, precoDesconto, parcelamento };
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
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for products to render (VendiZap loads via Firebase)
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          ".produto-card, .card-produto, [class*='produto'], [class*='product'], .v-card"
        );
        return cards.length > 0;
      },
      { timeout: 20000 }
    ).catch(() => {
      console.log("[Scraper] Timeout esperando cards. Tentando extrair do DOM...");
    });

    // Extra wait for images
    await new Promise((r) => setTimeout(r, 3000));

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 300));
      }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract products from the rendered DOM
    const rawProducts = await page.evaluate(() => {
      const products: Array<{
        nome: string;
        preco: number;
        fotoUrl: string;
        categoria: string;
        descricao: string;
      }> = [];

      // Strategy 1: VendiZap product cards
      const cards = document.querySelectorAll(
        ".produto-card, .card-produto, [class*='produto'], [class*='product'], .v-card"
      );

      if (cards.length > 0) {
        cards.forEach((card) => {
          const nome =
            card.querySelector(".nome-produto, .product-name, h3, h4, .title")
              ?.textContent?.trim() ?? "";
          const precoText =
            card.querySelector(
              ".preco, .price, .valor, [class*='preco'], [class*='price']"
            )?.textContent ?? "";
          const img = card.querySelector("img") as HTMLImageElement | null;
          const fotoUrl = img?.src ?? img?.getAttribute("data-src") ?? "";
          const categoria =
            card.getAttribute("data-categoria") ??
            card.querySelector(".categoria, .category")?.textContent?.trim() ??
            "";

          // Parse price from text like "R$ 199,90" or "199.90"
          const precoMatch = precoText.match(
            /R?\$?\s*([\d.,]+)/
          );
          const preco = precoMatch
            ? parseFloat(
                precoMatch[1].replace(/\./g, "").replace(",", ".")
              )
            : 0;

          if (nome && preco > 0) {
            products.push({ nome, preco, fotoUrl, categoria, descricao: "" });
          }
        });
      }

      // Strategy 2: If no cards found, try to extract from Vuex store
      if (products.length === 0) {
        const app = document.querySelector("#app") as HTMLElement & {
          __vue__?: { $store?: { state?: { global?: { produtos?: unknown[] } } } };
        };
        if (app?.__vue__?.$store?.state?.global) {
          const state = app.__vue__.$store.state.global as Record<string, unknown>;
          const prods = (state.produtos ?? state.Produtos ?? []) as Array<Record<string, unknown>>;
          prods.forEach((p) => {
            const nome = String(p.nome ?? p.name ?? "");
            const preco = Number(
              p.preco ?? p.precoVenda ?? p.valor ?? p.price ?? 0
            );
            const fotos = (p.fotos ?? []) as string[];
            const fotoUrl = fotos[0] ?? String(p.foto ?? p.imagem ?? p.imageUrl ?? "");
            const categoria = String(p.categoria ?? p.category ?? "");
            const descricao = String(p.descricao ?? p.description ?? "");

            if (nome && preco > 0) {
              products.push({ nome, preco, fotoUrl, categoria, descricao });
            }
          });
        }
      }

      // Strategy 3: Try extracting from any grid-like structure
      if (products.length === 0) {
        const allText = document.body.innerText;
        // Return the page text for debugging
        return { products: [], debug: allText.substring(0, 2000) };
      }

      return { products, debug: null };
    });

    if (rawProducts.products.length === 0) {
      console.log(
        "[Scraper] Nenhum produto encontrado. Debug:",
        rawProducts.debug?.substring(0, 500)
      );
      return [];
    }

    console.log(
      `[Scraper] ${rawProducts.products.length} produtos extraídos do DOM`
    );

    // Process and filter
    const result: ProdutoFornecedor[] = rawProducts.products.map((p) => {
      const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(
        p.preco
      );
      const isFerramenta = ehFerramenta(p.nome, p.categoria);
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
        ehFerramenta: isFerramenta,
      };
    });

    const ferramentas = result.filter((p) => p.ehFerramenta);
    console.log(
      `[Scraper] ${result.length} produtos total → ${ferramentas.length} ferramentas`
    );

    return ferramentas;
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
      const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(
        item.preco
      );
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
    .filter((p) => p.ehFerramenta);
}
