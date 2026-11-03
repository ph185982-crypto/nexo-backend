// Sessão por cookie assinado (HMAC-SHA256, Web Crypto — roda no Node e no middleware/Edge).
export const COOKIE_SESSAO = "avz_sessao";
const DURACAO_S = 60 * 60 * 24 * 7; // 7 dias

export interface Sessao { uid: string; exp: number }

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const deB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const chave = (segredo: string) => crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export function segredoDaSessao(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET ausente ou curto demais (mínimo 16 caracteres)");
  return s;
}

export async function assinarSessao(uid: string, segredo: string, agoraS = Math.floor(Date.now() / 1000)): Promise<string> {
  const corpo = b64url(enc.encode(JSON.stringify({ uid, exp: agoraS + DURACAO_S } satisfies Sessao)));
  const mac = await crypto.subtle.sign("HMAC", await chave(segredo), enc.encode(corpo));
  return `${corpo}.${b64url(mac)}`;
}

export async function verificarSessao(token: string | undefined | null, segredo: string, agoraS = Math.floor(Date.now() / 1000)): Promise<Sessao | null> {
  if (!token) return null;
  const [corpo, mac, resto] = token.split(".");
  if (!corpo || !mac || resto !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await chave(segredo), deB64url(mac), enc.encode(corpo));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(deB64url(corpo))) as Sessao;
    return typeof s.uid === "string" && typeof s.exp === "number" && s.exp > agoraS ? s : null;
  } catch {
    return null;
  }
}

export const DURACAO_SESSAO_S = DURACAO_S;
