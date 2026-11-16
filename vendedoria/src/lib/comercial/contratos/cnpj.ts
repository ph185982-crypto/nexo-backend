// Consulta de CNPJ (porta de contratos/api/cnpj.js): SERPRO com SERPRO_TOKEN; sem token ou se o SERPRO falhar,
// BrasilAPI (Receita Federal, sem autenticação). Devolve sempre o mesmo formato.
export interface DadosCnpj {
  razao_social: string; nome_fantasia: string; cnpj: string; logradouro: string; numero: string; complemento: string;
  bairro: string; municipio: string; uf: string; cep: string; endereco_completo?: string;
  qsa: Array<Record<string, unknown>>;
}

type Fetch = typeof fetch;
let transporte: Fetch | null = null;
export function definirTransporteCnpj(f: Fetch | null) { transporte = f; }
const f = (...a: Parameters<Fetch>) => (transporte ?? fetch)(...a);

const SERPRO = "https://apigateway.conectagov.estaleiro.serpro.gov.br";

export function validarCnpj(c: string): boolean {
  c = c.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n: number) => {
    const w = n === 1 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < w.length; i++) s += parseInt(c[i], 10) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(1) === parseInt(c[12], 10) && calc(2) === parseInt(c[13], 10);
}

export async function consultarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const limpo = cnpj.replace(/\D/g, "");
  const token = process.env.SERPRO_TOKEN?.trim();
  if (token) {
    try {
      const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const [emp, qsa] = await Promise.all([
        f(`${SERPRO}/api-cnpj-empresa/v2/empresa/${limpo}`, { headers: h, signal: AbortSignal.timeout(10_000) }),
        f(`${SERPRO}/api-cnpj-qsa/v2/qsa/${limpo}`, { headers: h, signal: AbortSignal.timeout(10_000) }),
      ]);
      if (emp.ok) {
        const e = await emp.json();
        const socios = qsa.ok ? ((await qsa.json())?.qsa ?? []) : [];
        const end = e.estabelecimento || e;
        return {
          razao_social: e.razao_social || "", nome_fantasia: end.nome_fantasia || e.nome_fantasia || "", cnpj: limpo,
          logradouro: end.logradouro || "", numero: end.numero || "", complemento: end.complemento || "", bairro: end.bairro || "",
          municipio: end.municipio || "", uf: end.uf || "", cep: end.cep || "", qsa: socios,
        };
      }
    } catch { /* cai na BrasilAPI */ }
  }
  try {
    const r = await f(`https://brasilapi.com.br/api/cnpj/v1/${limpo}`, { headers: { "User-Agent": "Comercial/1.0" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      razao_social: d.razao_social || "", nome_fantasia: d.nome_fantasia || "", cnpj: d.cnpj || limpo,
      logradouro: d.logradouro || "", numero: d.numero || "", complemento: d.complemento || "", bairro: d.bairro || "",
      municipio: d.municipio || "", uf: d.uf || "", cep: d.cep || "",
      endereco_completo: [d.logradouro, d.numero, d.complemento, d.bairro, d.municipio, d.uf].filter(Boolean).join(", "),
      qsa: d.qsa || [],
    };
  } catch {
    return null;
  }
}
