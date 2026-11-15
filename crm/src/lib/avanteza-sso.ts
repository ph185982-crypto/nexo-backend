// Avanteza ID — verificador do login único (SSO). Sem dependências; só roda no Node (usa node:crypto),
// então NÃO importe este arquivo no middleware (Edge) nem em componente de cliente.
//
// A Central (app.avanteza.com.br) assina um JWT ES256 de curta duração (60 s) para UM aplicativo (aud).
// Cada aplicativo confere a assinatura com a chave pública publicada em /.well-known/jwks.json e então
// cria a própria sessão local. Nenhum segredo é compartilhado entre os aplicativos.
//
// Porte fiel de packages/avanteza-kit/avanteza-sso.js (mesmas verificações, na mesma ordem).
import crypto from "node:crypto";

export const ISSUER = "avanteza-id";

/** Endereço da Central, sem barra no fim. Vem de AVANTEZA_HUB_URL (padrão: produção). */
export function hubUrl(): string {
  return (process.env.AVANTEZA_HUB_URL || "https://app.avanteza.com.br").replace(/\/$/, "");
}

/** Chave pública no formato JWK, como a Central publica. */
export interface ChaveJwk {
  kty?: string;
  crv?: string;
  kid?: string;
  x?: string;
  y?: string;
  [campo: string]: unknown;
}

export type PapelAvanteza = "admin" | "member" | "reviewer";

export interface IdentidadeAvanteza {
  email: string;
  name: string;
  role: PapelAvanteza | string;
  returnTo: string;
  jti?: string;
}

let cache: { at: number; keys: ChaveJwk[] } = { at: 0, keys: [] };
// Só para testes: chaves fixas no lugar da busca do JWKS (mesmo padrão de definirModelo/definirTransporteGoogle).
let chavesFixas: ChaveJwk[] | null = null;

/** Testes injetam as chaves públicas aqui (sem rede). `null` volta a buscar o JWKS da Central. */
export function definirChavesAvanteza(keys: ChaveJwk[] | null): void {
  chavesFixas = keys;
  cache = { at: 0, keys: [] };
}

async function getKeys(force: boolean): Promise<ChaveJwk[]> {
  if (!force && cache.keys.length && Date.now() - cache.at < 10 * 60 * 1000) return cache.keys;
  const res = await fetch(`${hubUrl()}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS indisponível (${res.status})`);
  const body = (await res.json()) as { keys?: unknown };
  cache = { at: Date.now(), keys: Array.isArray(body.keys) ? (body.keys as ChaveJwk[]) : [] };
  return cache.keys;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- conteúdo do token: cada campo é conferido antes de usar
const b64json = (s: string): any => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Confere assinatura, emissor, destinatário e validade. Lança erro se algo não bater. */
export async function verifyAvantezaToken(
  token: string | null | undefined,
  { audience, keys }: { audience?: string; keys?: ChaveJwk[] } = {},
): Promise<IdentidadeAvanteza> {
  if (!audience) throw new Error("audience obrigatório");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("token malformado");
  const header = b64json(parts[0]);
  if (header.alg !== "ES256") throw new Error("algoritmo não aceito");
  const fixas = keys ?? chavesFixas ?? undefined;
  const find = (list: ChaveJwk[]) => list.find((k) => k.kid === header.kid && k.kty === "EC" && k.crv === "P-256");
  let jwk = find(fixas || (await getKeys(false)));
  if (!jwk && !fixas) jwk = find(await getKeys(true)); // chave trocada: busca de novo
  if (!jwk) throw new Error("chave desconhecida");
  const ok = crypto.verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("assinatura inválida");
  const p = b64json(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== ISSUER) throw new Error("emissor inválido");
  if (p.aud !== audience) throw new Error("token emitido para outro aplicativo");
  if (typeof p.exp !== "number" || p.exp < now - 5) throw new Error("token expirado");
  if (typeof p.iat === "number" && p.iat > now + 60) throw new Error("token do futuro");
  if (!p.sub) throw new Error("token sem usuário");
  const ret = typeof p.ret === "string" && p.ret.startsWith("/") && !p.ret.startsWith("//") ? p.ret : "/";
  return { email: String(p.sub).toLowerCase(), name: p.name || "", role: p.role || "member", returnTo: ret, jti: p.jti };
}

/** Endereço da Central que inicia o login para este aplicativo. */
export function authorizeUrl(appId: string, returnTo = "/"): string {
  const u = new URL(`${hubUrl()}/sso/authorize`);
  u.searchParams.set("app", appId);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

/** Endereço do painel da Central (atalho no menu de cada aplicativo). */
export function centralUrl(): string {
  return `${hubUrl()}/central`;
}

/** Só caminho interno do próprio aplicativo ("/algo"); qualquer outra coisa vira "/". */
export function caminhoInterno(caminho: string | null | undefined): string {
  return typeof caminho === "string" && caminho.startsWith("/") && !caminho.startsWith("//") && !caminho.includes("\\") ? caminho : "/";
}
