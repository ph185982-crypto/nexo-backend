// ── VendiZap API Scraper ─────────────────────────────────────────────────────
// Uses VendiZap's public REST API directly instead of Puppeteer.
// Flow:
//   1. GET  /webservice/tabela/subdominio?subdominio=<sub>  → idUsuario
//   2. POST /webservice/Vitrine/carregarVitrine             → paginated products

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

interface VendizapImagem {
  link?: string;
  linkOriginal?: string;
}

interface VendizapProduto {
  _id: string;
  descricao?: string;   // ← this is the NAME (misleading field name)
  detalhes?: string;    // ← this is the DESCRIPTION (HTML)
  detalhesFormatado?: string;
  preco?: number;
  codigo?: string;
  imagens?: VendizapImagem[];
  categorias?: Array<{ $oid?: string }>;
  ativo?: boolean;
  exibir?: boolean;
  promocao?: { precoDesconto?: number; preco?: number } | null;
}

interface VitrineResponse {
  quantidadePaginacao?: number;
  listas?: {
    listaDestaques?: VendizapProduto[];
    listaPromocoes?: VendizapProduto[];
    listaMaisVendidos?: VendizapProduto[];
    listaGaleria?: VendizapProduto[];
  };
}

// ── Classificador de ferramentas ──────────────────────────────────────────────

export function ehFerramenta(nome: string, categoria: string): boolean {
  const palavras = [
    "ferramenta", "chave", "soquete", "catraca", "furadeira", "parafusadeira",
    "impacto", "esmerilhadeira", "esmeril", "lixadeira", "serra", "serrote",
    "martelo", "alicate", "compressor", "soldador", "solda", "torno",
    "mandril", "broca", "ponteira", "torquimetro", "multimetro", "nivel",
    "trena", "bateria", "carregador", "maleta", "jogo", "politriz", "plaina",
    "soprador", "aspirador", "lavadora", "tupia", "retifica", "morsa",
    "parafuso", "rebarbadora", "makita", "bosch", "dewalt", "tramontina",
    "vonder", "schulz", "stanley", "maquita", "cortadora", "britadeira",
    "grampeador", "rebitadeira", "marreta", "lima", "formao", "prumo",
    "esquadro", "paquimetro", "medidor", "tarraxa", "gabarito", "morsa",
    "tenaz", "arco", "lamina", "disco",
  ];
  const texto = (nome + " " + categoria)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return palavras.some((p) =>
    texto.includes(p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
  );
}

// ── Cálculo de preços (margem 75% sobre o custo) ─────────────────────────────

export function calcularPrecos(precoCusto: number, margemPercent = 75) {
  const precoVenda    = Math.round(precoCusto * (1 + margemPercent / 100) * 100) / 100;
  const precoDesconto = precoVenda;
  const parcelamento  = Math.round((precoVenda / 10) * 100) / 100;
  return { precoVenda, precoDesconto, parcelamento };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extrairSubdominio(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (!host.endsWith(".vendizap.com")) return null;
    const parts = host.split(".");
    return parts.length >= 3 ? parts[0] : null;
  } catch {
    return null;
  }
}

function limparHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const VENDIZAP_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  "Accept": "application/json, text/plain, */*",
  "app-version": "999999",
  "platformos": "web",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

async function fetchIdUsuario(subdominio: string): Promise<string> {
  const url = `https://app.vendizap.com/webservice/tabela/subdominio?subdominio=${encodeURIComponent(subdominio)}`;
  const res = await fetch(url, { headers: VENDIZAP_HEADERS });
  if (!res.ok) throw new Error(`subdominio ${subdominio}: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { id?: string; nome_empresa?: string };
  if (!data.id) throw new Error(`subdominio ${subdominio}: sem idUsuario na resposta`);
  console.log(`[Scraper] Loja identificada: ${data.nome_empresa?.trim()} (${data.id})`);
  return data.id;
}

async function fetchPagina(
  idUsuario: string,
  pagina: number,
  referer: string
): Promise<VitrineResponse> {
  const body = {
    idUsuario,
    textoPesquisa: "",
    categoria: [],
    filtrosVitrine: { texto: "", precoMin: 0, precoMax: 0, variacoes: [] },
    isTabela: true,
    permiteCache: true,
    tipoCache: "geral",
    produtoURL: null,
    isMobile: false,
    paginaGerais: pagina,
    paginaPromocoes: 0,
  };
  const res = await fetch("https://app.vendizap.com/webservice/Vitrine/carregarVitrine", {
    method: "POST",
    headers: {
      ...VENDIZAP_HEADERS,
      Origin: new URL(referer).origin,
      Referer: referer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`carregarVitrine pg=${pagina}: ${res.status}`);
  return (await res.json()) as VitrineResponse;
}

// ── Scraper principal ────────────────────────────────────────────────────────

export async function scrapeFornecedor(
  url = "https://yanne.vendizap.com/"
): Promise<ProdutoFornecedor[]> {
  const subdominio = extrairSubdominio(url);
  if (!subdominio) {
    throw new Error(`URL inválida: ${url} — esperado *.vendizap.com`);
  }
  console.log(`[Scraper] Iniciando scraping de ${url} (subdomínio: ${subdominio})`);

  const idUsuario = await fetchIdUsuario(subdominio);

  const produtosRaw: VendizapProduto[] = [];
  const seenIds = new Set<string>();
  const MAX_PAGINAS = 100;
  const MAX_PRODUTOS = 2000;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const data = await fetchPagina(idUsuario, pagina, url);
    const galeria = data.listas?.listaGaleria ?? [];
    const destaques = pagina === 0 ? data.listas?.listaDestaques ?? [] : [];
    const promocoes = pagina === 0 ? data.listas?.listaPromocoes ?? [] : [];

    const batch = [...galeria, ...destaques, ...promocoes];
    let novos = 0;
    for (const p of batch) {
      if (!p._id || seenIds.has(p._id)) continue;
      seenIds.add(p._id);
      produtosRaw.push(p);
      novos++;
    }

    console.log(`[Scraper] Página ${pagina}: +${novos} (total=${produtosRaw.length})`);

    if (galeria.length === 0 && pagina > 0) break;
    if (produtosRaw.length >= MAX_PRODUTOS) break;
  }

  console.log(`[Scraper] Total de produtos brutos: ${produtosRaw.length}`);

  const todos: ProdutoFornecedor[] = [];
  for (const p of produtosRaw) {
    const nome = (p.descricao ?? "").trim();
    const preco = Number(p.preco ?? 0);
    if (!nome || preco <= 0) continue;
    if (p.ativo === false || p.exibir === false) continue;

    const foto = p.imagens?.[0]?.linkOriginal ?? p.imagens?.[0]?.link ?? "";
    const descricao = limparHtml(p.detalhesFormatado ?? p.detalhes ?? "");
    const categoria = p.categorias?.[0]?.$oid ?? "";
    const { precoVenda, precoDesconto, parcelamento } = calcularPrecos(preco);

    todos.push({
      nome,
      precoCusto: preco,
      precoVenda,
      precoDesconto,
      parcelamento,
      fotoUrl: foto,
      descricao,
      categoria,
      disponivel: true,
      ehFerramenta: ehFerramenta(nome, categoria + " " + descricao),
    });
  }

  const ferramentas = todos.filter((p) => p.ehFerramenta);
  console.log(
    `[Scraper] ${todos.length} produtos válidos → ${ferramentas.length} ferramentas`
  );
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
    .filter((p) => p.nome && p.precoCusto > 0);
}
