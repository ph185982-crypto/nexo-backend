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
    "catraca", "torquimetro", "multimetro", "nivel", "trena",
    "ferramenta", "bateria", "carregador", "maleta", "jogo", "chaves",
    "politriz", "plaina", "soprador", "aspirador", "lavadora",
    "maquita", "tupia", "retifica", "morsa", "parafuso", "rebarbadora",
    "makita", "bosch", "dewalt", "tramontina", "vonder", "schulz",
    "stanley", "wesco", "worker", "skil", "black", "decker",
    "eletrica", "eletronica", "voltagem", "tensao", "bivolt",
    "rpm", "watts", "hp", "motor", "profissional", "industrial",
    "aparelho", "maquina", "equipamento", "politriz", "lixadora",
    "v", "w",
  ];
  const texto = (nome + " " + categoria).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return palavras.some((p) => texto.includes(p.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

// ── Cálculo de preços (margem de 75% sobre o custo) ──────────────────────────

export function calcularPrecos(precoCusto: number, margemPercent = 75) {
  const precoVenda    = Math.round(precoCusto * (1 + margemPercent / 100) * 100) / 100;
  const precoDesconto = precoVenda;
  const parcelamento  = Math.round((precoVenda / 10) * 100) / 100;
  return { precoVenda, precoDesconto, parcelamento };
}

// ── Raw product type ──────────────────────────────────────────────────────────

interface RawProduct {
  nome: string;
  preco: number;
  fotoUrl: string;
  categoria: string;
  descricao: string;
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parseFirebaseRTDB(data: Record<string, unknown>): RawProduct[] {
  const products: RawProduct[] = [];
  const seen = new Set<string>();

  const processEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const nome = String(e.titulo ?? e.nome ?? e.name ?? "").trim();
    const preco = Number(e.preco ?? e.precoVenda ?? e.valor ?? e.price ?? 0);
    if (!nome || preco <= 0 || seen.has(nome)) return;
    seen.add(nome);
    const fotos = Array.isArray(e.fotos) ? (e.fotos as string[]) : [];
    products.push({
      nome,
      preco,
      fotoUrl: fotos[0] ?? String(e.fotoUrl ?? e.foto ?? e.imagem ?? e.imageUrl ?? ""),
      categoria: String(e.categoria ?? e.category ?? ""),
      descricao: String(e.descricao ?? e.description ?? ""),
    });
  };

  // RTDB returns an object keyed by push-ID
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) {
      val.forEach(processEntry);
    } else {
      processEntry(val);
    }
  }
  return products;
}

function parseFirestore(data: Record<string, unknown>): RawProduct[] {
  const documents = (data.documents ?? []) as Array<{ fields?: Record<string, unknown> }>;
  const products: RawProduct[] = [];
  for (const doc of documents) {
    if (!doc.fields) continue;
    const f = doc.fields as Record<string, { stringValue?: string; doubleValue?: number; integerValue?: string; arrayValue?: { values?: Array<{ stringValue?: string }> } }>;
    const nome = f.titulo?.stringValue ?? f.nome?.stringValue ?? "";
    const preco = f.preco?.doubleValue ?? Number(f.preco?.integerValue ?? 0);
    if (!nome || preco <= 0) continue;
    const fotos = f.fotos?.arrayValue?.values?.map((v) => v.stringValue ?? "") ?? [];
    products.push({
      nome,
      preco,
      fotoUrl: fotos[0] ?? f.fotoUrl?.stringValue ?? "",
      categoria: f.categoria?.stringValue ?? "",
      descricao: f.descricao?.stringValue ?? "",
    });
  }
  return products;
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

    // ── Intercept network responses BEFORE navigation ─────────────────────
    const networkProducts: RawProduct[] = [];
    await page.setRequestInterception(true);
    page.on("request", (req) => req.continue());

    page.on("response", async (response) => {
      if (networkProducts.length > 0) return; // already got data
      const respUrl = response.url();
      const ct = response.headers()["content-type"] ?? "";
      if (response.status() !== 200 || !ct.includes("json")) return;

      const isFirebase =
        respUrl.includes("firebaseio.com") ||
        respUrl.includes("firestore.googleapis.com") ||
        respUrl.includes("firebase") ||
        respUrl.includes("/produtos") ||
        respUrl.includes("/products") ||
        respUrl.includes("/vitrine") ||
        respUrl.includes("/catalog");

      if (!isFirebase) return;

      try {
        const json = (await response.json()) as Record<string, unknown>;
        console.log(`[Scraper] Resposta de rede: ${respUrl.substring(0, 100)}`);

        let parsed: RawProduct[] = [];

        if (respUrl.includes("firestore.googleapis.com")) {
          parsed = parseFirestore(json);
        } else {
          parsed = parseFirebaseRTDB(json);
        }

        if (parsed.length > 0) {
          networkProducts.push(...parsed);
          console.log(`[Scraper] Rede capturou ${parsed.length} produtos`);
        }
      } catch {
        // not parseable JSON, ignore
      }
    });

    // ── Navigate ──────────────────────────────────────────────────────────
    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 6000)); // let async requests settle

    if (networkProducts.length > 0) {
      console.log(`[Scraper] Usando dados de rede: ${networkProducts.length} produtos`);
      return toFornecedorList(networkProducts);
    }

    // ── Fallback 1: Vuex store ────────────────────────────────────────────
    console.log("[Scraper] Sem dados de rede — tentando Vuex store...");

    const vuexProducts = await page.evaluate((): RawProduct[] => {
      const app = document.querySelector("#app") as HTMLElement & {
        __vue__?: { $store?: { state?: Record<string, unknown> } };
        __vue_app__?: { config?: { globalProperties?: { $store?: { state?: Record<string, unknown> } } } };
      };

      const storeState = (
        app?.__vue__?.$store?.state ??
        app?.__vue_app__?.config?.globalProperties?.$store?.state
      ) as Record<string, Record<string, unknown[]>> | undefined;

      if (!storeState) return [];

      const prodMod = storeState.produto as Record<string, unknown[]> | undefined;
      if (!prodMod) return [];

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
        const nome = String(p.titulo ?? p.nome ?? p.name ?? "").trim();
        const preco = Number(p.preco ?? p.precoVenda ?? p.valor ?? p.price ?? 0);
        if (!nome || preco <= 0) continue;
        const fotos = Array.isArray(p.fotos) ? (p.fotos as string[]) : [];
        products.push({
          nome,
          preco,
          fotoUrl: fotos[0] ?? String(p.fotoUrl ?? p.foto ?? p.imagem ?? ""),
          categoria: String(p.categoria ?? p.category ?? ""),
          descricao: String(p.descricao ?? p.description ?? ""),
        });
      }
      return products;
    });

    if (vuexProducts.length > 0) {
      console.log(`[Scraper] Vuex store: ${vuexProducts.length} produtos`);
      return toFornecedorList(vuexProducts);
    }

    // ── Fallback 2: DOM ───────────────────────────────────────────────────
    console.log("[Scraper] Vuex vazio — tentando DOM fallback...");

    const domProducts = await page.evaluate((): RawProduct[] => {
      // VendiZap-specific selectors first, then generic
      const cardSelectors = [
        ".produto-card",
        ".card-produto",
        "[class*='produto-card']",
        "[class*='card-produto']",
        "[class*='produto']",
        "[class*='product-card']",
        "article",
      ];

      for (const sel of cardSelectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length < 2) continue;

        const products: RawProduct[] = [];
        cards.forEach((card) => {
          // Try many name selectors
          const nomeEl = card.querySelector(
            ".titulo-produto, .nome-produto, .product-name, .product-title, " +
            "[class*='titulo'], [class*='nome'], [class*='title'], " +
            "h2, h3, h4, p.titulo, p.nome, span.titulo"
          );
          const nome = (nomeEl?.textContent ?? "").trim();

          // Try many price selectors
          const precoEl = card.querySelector(
            ".preco-produto, .valor-produto, .price, " +
            "[class*='preco'], [class*='valor'], [class*='price'], " +
            "span.preco, p.preco, strong"
          );
          const precoText = precoEl?.textContent ?? "";
          const precoMatch = precoText.match(/[\d]+[.,][\d]{2}/);
          const preco = precoMatch
            ? parseFloat(precoMatch[0].replace(/\./g, "").replace(",", "."))
            : 0;

          // Image: prefer data-src (lazy-load) over src
          const img = card.querySelector("img") as HTMLImageElement | null;
          const fotoUrl =
            img?.getAttribute("data-src") ??
            img?.getAttribute("data-lazy-src") ??
            img?.src ??
            "";

          if (nome && preco > 0) {
            products.push({ nome, preco, fotoUrl, categoria: "", descricao: "" });
          }
        });

        if (products.length > 0) {
          return products;
        }
      }
      return [];
    });

    if (domProducts.length > 0) {
      console.log(`[Scraper] DOM fallback: ${domProducts.length} produtos`);
      return toFornecedorList(domProducts);
    }

    console.log("[Scraper] Nenhum produto encontrado em nenhuma estratégia.");
    return [];
  } finally {
    await browser.close();
  }
}

// ── Convert raw → ProdutoFornecedor (only ferramentas) ────────────────────────

function toFornecedorList(rawList: RawProduct[]): ProdutoFornecedor[] {
  const seen = new Set<string>();
  const all: ProdutoFornecedor[] = [];

  for (const p of rawList) {
    if (!p.nome || p.preco <= 0 || seen.has(p.nome)) continue;
    seen.add(p.nome);
    const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(p.preco);
    all.push({
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
    });
  }

  const ferramentas = all.filter((p) => p.ehFerramenta);
  console.log(`[Scraper] ${all.length} produtos → ${ferramentas.length} ferramentas`);
  return ferramentas;
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
    .filter((p) => p.ehFerramenta);
}
