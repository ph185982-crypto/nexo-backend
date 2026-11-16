// Contratos: tipos e regras puras (sem banco, sem rede). Usado pelo servidor e pela tela.
//
// O formulário é o mesmo do app Contratos antigo (contratos/index.html, collectForm()): os nomes dos campos
// foram mantidos para que o histórico importado do navegador ("nexo_history_v1") e o "Gerar de novo" funcionem.

export interface FormContrato {
  modelo: "growth" | "barbearia" | string;
  plano: string; // BASE | ESCALE | GROWTH | MARKETPLACE
  preco: string; // "1.997,90"
  pgto2: string; // "30" | "45" | "60"
  cnpj: string;
  razao: string;
  fantasia: string;
  rep: string;
  email: string;
  whats: string;
  end: string;
  inicio: string; // YYYY-MM-DD
  duracao: string;
  venc: string;
  marca: string; // avanteza | nexo
  renov: string;
  garantia: boolean;
  /** Só nos importados: id do item no histórico do navegador. */
  _idOriginal?: string;
}

export const STATUS_CONTRATO = ["GERADO", "ENVIADO", "ASSINADO_PARCIAL", "ASSINADO", "RECUSADO", "CANCELADO", "ERRO"] as const;
export type StatusContrato = (typeof STATUS_CONTRATO)[number];

export const ROTULO_STATUS: Record<string, string> = {
  GERADO: "Gerado", ENVIADO: "Aguardando assinatura", ASSINADO_PARCIAL: "Assinado em parte", ASSINADO: "Assinado",
  RECUSADO: "Recusado", CANCELADO: "Cancelado", ERRO: "Erro no envio",
};

/** Status que ainda podem mudar na ClickSign (a reconciliação consulta só estes). */
export const STATUS_EM_ABERTO: StatusContrato[] = ["ENVIADO", "ASSINADO_PARCIAL"];

export const ROTULO_MODELO: Record<string, string> = { growth: "Growth Engine", barbearia: "Barbearia" };

/**
 * Serviços que a Central liga ao cliente quando o contrato é assinado (payload.servicos do evento contrato.assinado).
 * Mapa explícito, por modelo e plano do formulário:
 *  - barbearia            → tráfego pago + mídias sociais (escopo: Facebook/Instagram Ads, posts, vídeos)
 *  - growth / BASE        → marketplace (consultoria + 1 canal de vendas e a publicidade dentro dele)
 *  - growth / ESCALE      → marketplace + tráfego (inclui "Ads em outras plataformas: TikTok, Google, Facebook")
 *  - growth / GROWTH      → marketplace + tráfego (idem, semanal)
 *  - growth / MARKETPLACE → marketplace (3 canais; os Ads são os dos próprios marketplaces)
 * Plano desconhecido no modelo growth cai em ["marketplace"].
 */
export type Servico = "marketplace" | "trafego" | "midias";
export const SERVICOS_POR_PLANO: Record<string, Servico[]> = {
  BASE: ["marketplace"],
  ESCALE: ["marketplace", "trafego"],
  GROWTH: ["marketplace", "trafego"],
  MARKETPLACE: ["marketplace"],
};
export const SERVICOS_BARBEARIA: Servico[] = ["trafego", "midias"];

export function servicosDoContrato(modelo: string, plano?: string | null): Servico[] {
  if (modelo === "barbearia") return [...SERVICOS_BARBEARIA];
  return [...(SERVICOS_POR_PLANO[String(plano ?? "").toUpperCase()] ?? ["marketplace"])];
}

/** "1.997,90" | "1997.9" | "R$ 2.500" → 1997.9. Vazio/inválido → null. Mesma leitura do fmtBRL do app antigo. */
export function lerValor(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const inteiro = (v: unknown, min: number, max: number): number | null => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const texto = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

/** Normaliza o formulário recebido (corta tamanhos, garante tipos). Não inventa campos. */
export function normalizarForm(bruto: unknown): FormContrato {
  const f = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const out: FormContrato = {
    modelo: f.modelo === "barbearia" ? "barbearia" : "growth",
    plano: texto(f.plano, 30).toUpperCase() || "ESCALE",
    preco: texto(f.preco, 30), pgto2: ["30", "45", "60"].includes(String(f.pgto2)) ? String(f.pgto2) : "45",
    cnpj: texto(f.cnpj, 30), razao: texto(f.razao), fantasia: texto(f.fantasia), rep: texto(f.rep), email: texto(f.email, 200),
    whats: texto(f.whats, 40), end: texto(f.end, 500), inicio: /^\d{4}-\d{2}-\d{2}$/.test(String(f.inicio ?? "")) ? String(f.inicio) : "",
    duracao: texto(f.duracao, 4), venc: texto(f.venc, 4), marca: f.marca === "nexo" ? "nexo" : "avanteza", renov: texto(f.renov, 30),
    garantia: f.garantia === true || f.garantia === "true",
  };
  if (typeof f._idOriginal === "string" && f._idOriginal) out._idOriginal = f._idOriginal.slice(0, 100);
  return out;
}

/** O que falta para gerar o contrato (mesma regra do validateForm do app antigo). */
export function camposFaltando(f: FormContrato): string[] {
  const falta: string[] = [];
  if (!f.razao) falta.push("Razão social");
  if (!f.rep) falta.push("Representante legal");
  if (!f.inicio) falta.push("Data de início");
  if (!inteiro(f.duracao, 1, 60)) falta.push("Duração");
  if (!inteiro(f.venc, 1, 31)) falta.push("Vencimento");
  if (!lerValor(f.preco)) falta.push("Valor mensal");
  return falta;
}

/** Colunas do ContratoEmitido derivadas do formulário. */
export function camposDoForm(f: FormContrato) {
  return {
    modelo: f.modelo,
    plano: f.modelo === "barbearia" ? null : f.plano || null,
    marca: f.marca,
    razaoSocial: f.razao || f.fantasia || "Sem nome",
    nomeFantasia: f.fantasia || null,
    cnpj: f.cnpj.replace(/\D/g, "") || null,
    representante: f.rep || null,
    emailCliente: f.email || null,
    telefoneCliente: f.whats.replace(/\D/g, "") || null,
    valor: lerValor(f.preco),
    duracaoMeses: inteiro(f.duracao, 1, 600),
    inicioEm: f.inicio ? new Date(`${f.inicio}T12:00:00Z`) : null,
    vencimentoDia: inteiro(f.venc, 1, 31),
  };
}

/** Telefone para a ClickSign: só dígitos, sem o 55 do Brasil. */
export function telefoneNacional(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d;
}

/** Status do envelope v3 (draft | running | closed | canceled) → status do contrato. */
export function statusDoEnvelope(raw: string | null | undefined, atual?: string): StatusContrato | null {
  switch (raw) {
    case "closed": return "ASSINADO";
    case "canceled": return atual === "RECUSADO" ? "RECUSADO" : "CANCELADO";
    case "running": return atual === "ASSINADO_PARCIAL" ? "ASSINADO_PARCIAL" : "ENVIADO";
    case "draft": return atual === "GERADO" || atual === "ERRO" ? (atual as StatusContrato) : "ENVIADO";
    default: return null;
  }
}

/** Nome de arquivo do PDF (mesma regra do gerarPDFAvanteza). */
export function nomeArquivo(f: FormContrato): string {
  const bh = f.modelo === "barbearia";
  const marca = f.marca === "nexo" ? "GrowthEngine" : "Avanteza";
  return `Contrato_${bh ? "Barbearia" : marca}_${(f.razao || "Cliente").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}${bh ? "" : "_" + f.plano}.pdf`;
}

/** Valor exato do contrato (a lista do Comercial abrevia; contrato mostra centavos). */
export const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "11222333000181" → "11.222.333/0001-81" (outros tamanhos ficam como vieram). */
export function cnpjFormatado(d: string | null | undefined): string {
  const x = String(d ?? "").replace(/\D/g, "");
  return x.length === 14 ? `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}` : String(d ?? "");
}
