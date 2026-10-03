// OAuth 2.1 (PKCE + registro dinâmico) sem estado, para o conector do Claude.ai.
// Códigos, tokens e client_ids são payloads assinados com HMAC — não há tabela
// nova. A chave é derivada de MCP_SECRET; a "senha" da tela de autorização
// também é o MCP_SECRET. Trocar o MCP_SECRET invalida tudo.

import { createHmac, createHash, timingSafeEqual } from "crypto";

export const TTL_CODIGO = 5 * 60;
export const TTL_ACESSO = 60 * 60 * 24 * 30; // 30 dias
export const TTL_REFRESH = 60 * 60 * 24 * 180; // 180 dias

type Tipo = "client" | "code" | "access" | "refresh";
export interface Payload {
  t: Tipo;
  exp: number;
  [k: string]: unknown;
}

function chave(): string | null {
  const s = process.env.MCP_SECRET;
  return s ? createHmac("sha256", s).update("nexo-mcp-oauth-v1").digest("hex") : null;
}

export function agora(): number {
  return Math.floor(Date.now() / 1000);
}

export function assinar(p: Payload): string {
  const k = chave();
  if (!k) throw new Error("MCP_SECRET não configurado");
  const corpo = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", k).update(corpo).digest("base64url");
  return `${corpo}.${sig}`;
}

export function verificar(token: string | null | undefined, tipo: Tipo): Payload | null {
  const k = chave();
  if (!k || !token) return null;
  const [corpo, sig] = token.split(".");
  if (!corpo || !sig) return null;
  const esperado = createHmac("sha256", k).update(corpo).digest("base64url");
  if (!iguais(sig, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString()) as Payload;
    return p.t === tipo && p.exp > agora() ? p : null;
  } catch {
    return null;
  }
}

export function iguais(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function pkceConfere(verifier: string, challenge: string): boolean {
  const calc = createHash("sha256").update(verifier).digest("base64url");
  return iguais(calc, challenge);
}

/** Origem pública (https://host) a partir dos headers da requisição. */
export function origem(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function redirectPermitido(uri: string, permitidos: string[]): boolean {
  return permitidos.includes(uri);
}

export function emitirTokens(clientId: string) {
  const t = agora();
  return {
    access_token: assinar({ t: "access", exp: t + TTL_ACESSO, cid: clientId }),
    token_type: "Bearer",
    expires_in: TTL_ACESSO,
    refresh_token: assinar({ t: "refresh", exp: t + TTL_REFRESH, cid: clientId }),
  };
}

export function bearerValido(authorization: string | null): boolean {
  const segredo = process.env.MCP_SECRET;
  if (!segredo || !authorization?.startsWith("Bearer ")) return false;
  const tk = authorization.slice(7);
  return iguais(tk, segredo) || verificar(tk, "access") !== null;
}
