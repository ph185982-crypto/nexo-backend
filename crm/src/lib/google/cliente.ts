// Cliente mínimo do Google: OAuth (conectar, renovar o token) e GET nas APIs da Agenda e do Meet.
// Sem SDK do Google: são poucas chamadas REST. O transporte pode ser trocado nos testes (sem rede).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";

export const ESCOPOS = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly", // quem foi convidado para a reunião
  "https://www.googleapis.com/auth/meetings.space.readonly", // registros, participantes e transcrições do Meet
] as const;

const AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export type CredenciaisGoogle = { clientId: string; clientSecret: string; origem: "AMBIENTE" | "CONFIGURACAO" };
const CHAVE_ID = "google.clientId", CHAVE_SEGREDO = "google.clientSecret";

/** Variáveis de ambiente valem mais; sem elas, as credenciais salvas pelo administrador em Configuração → Google. */
export async function credenciaisGoogle(): Promise<CredenciaisGoogle | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(), clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret, origem: "AMBIENTE" };
  const linhas = await prisma.configuracao.findMany({ where: { chave: { in: [CHAVE_ID, CHAVE_SEGREDO] } } });
  const id = linhas.find((l) => l.chave === CHAVE_ID)?.valor, segredo = linhas.find((l) => l.chave === CHAVE_SEGREDO)?.valor;
  if (!id || !segredo) return null;
  try { return { clientId: id, clientSecret: decifrar(segredo), origem: "CONFIGURACAO" }; } catch { return null; } // SESSION_SECRET mudou
}

/** ID do cliente OAuth do Google (Aplicativo da Web): termina em .apps.googleusercontent.com. */
export function validarCredenciais(clientId: unknown, clientSecret: unknown): { clientId: string; clientSecret: string } {
  const id = typeof clientId === "string" ? clientId.trim() : "", segredo = typeof clientSecret === "string" ? clientSecret.trim() : "";
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id) || id.length > 200) throw new ErroEntrada("ID do cliente inválido: copie o que termina em .apps.googleusercontent.com");
  if (segredo.length < 10 || segredo.length > 200 || /\s/.test(segredo)) throw new ErroEntrada("Chave secreta inválida");
  return { clientId: id, clientSecret: segredo };
}

export async function salvarCredenciais(c: { clientId: string; clientSecret: string }) {
  await prisma.$transaction([
    prisma.configuracao.upsert({ where: { chave: CHAVE_ID }, update: { valor: c.clientId }, create: { chave: CHAVE_ID, valor: c.clientId } }),
    prisma.configuracao.upsert({ where: { chave: CHAVE_SEGREDO }, update: { valor: cifrar(c.clientSecret) }, create: { chave: CHAVE_SEGREDO, valor: cifrar(c.clientSecret) } }),
  ]);
}

export const apagarCredenciais = () => prisma.configuracao.deleteMany({ where: { chave: { in: [CHAVE_ID, CHAVE_SEGREDO] } } });

type Transporte = (url: string, init?: RequestInit) => Promise<Response>;
let transporte: Transporte = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
/** Testes trocam o transporte por um falso. null volta ao fetch. */
export function definirTransporteGoogle(t: Transporte | null) { transporte = t ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })); }

export class ErroGoogle extends Error {
  constructor(mensagem: string, readonly status: number, readonly reconectar = false) { super(mensagem); }
}

/** Endereço de volta do OAuth: o mesmo domínio em que a pessoa está (ou GOOGLE_REDIRECT_URI, se definido). Precisa estar cadastrado no Google Cloud. */
export const enderecoDeRetorno = (req: Request) => process.env.GOOGLE_REDIRECT_URI?.trim() || `${new URL(req.url).origin}/api/google/callback`;

export async function urlDeAutorizacao(redirectUri: string, state: string): Promise<string> {
  const cred = await credenciaisGoogle();
  if (!cred) throw new ErroGoogle("Credenciais do Google não configuradas no CRM (Configuração → Google)", 503);
  const u = new URL(AUTORIZAR);
  u.searchParams.set("client_id", cred.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", ESCOPOS.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // garante refresh_token
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

interface RespostaToken { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string }

async function pedirToken(corpo: Record<string, string>): Promise<RespostaToken> {
  const cred = await credenciaisGoogle();
  if (!cred) throw new ErroGoogle("Credenciais do Google não configuradas no CRM (Configuração → Google)", 503);
  const r = await transporte(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...corpo, client_id: cred.clientId, client_secret: cred.clientSecret }).toString() });
  const j = (await r.json().catch(() => ({}))) as RespostaToken & { error?: string; error_description?: string };
  // invalid_grant = acesso revogado ou token expirado: só reconectando.
  if (!r.ok) throw new ErroGoogle(`Google recusou o token: ${j.error_description ?? j.error ?? r.status}`, r.status, j.error === "invalid_grant");
  if (!j.access_token || !Number.isFinite(j.expires_in)) throw new ErroGoogle("Resposta do Google sem token de acesso", 502);
  return j;
}

export const trocarCodigo = (code: string, redirectUri: string) => pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
export const renovarToken = (refreshToken: string) => pedirToken({ grant_type: "refresh_token", refresh_token: refreshToken });

/** E-mail da conta, lido do id_token devolvido na troca do código (sem verificar assinatura: veio direto do Google por HTTPS). */
export function emailDoIdToken(idToken: string | undefined): string | null {
  const parte = idToken?.split(".")[1];
  if (!parte) return null;
  try { return (JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as { email?: string }).email ?? null; } catch { return null; }
}

/** GET autenticado numa API do Google; 401/403 viram ErroGoogle (403 costuma ser API não ativada ou escopo faltando). */
export async function getGoogle<T>(url: string, accessToken: string): Promise<T> {
  const r = await transporte(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ErroGoogle(`Google ${r.status}: ${j.error?.message ?? "erro"}`.slice(0, 300), r.status, r.status === 401);
  }
  return r.json() as Promise<T>;
}

/** Percorre uma lista paginada (pageToken/nextPageToken) até `maxPaginas`. */
export async function listarTudo<T>(urlBase: string, chave: string, accessToken: string, maxPaginas = 20): Promise<T[]> {
  const itens: T[] = [];
  let token: string | undefined;
  for (let i = 0; i < maxPaginas; i++) {
    const u = new URL(urlBase);
    if (token) u.searchParams.set("pageToken", token);
    const j = await getGoogle<Record<string, unknown> & { nextPageToken?: string }>(u.toString(), accessToken);
    itens.push(...((j[chave] as T[] | undefined) ?? []));
    token = j.nextPageToken;
    if (!token) break;
  }
  return itens;
}

// ── Cifra do refresh token ──────────────────────────────────────────────────
function chave(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET ausente");
  return createHash("sha256").update(`${s}:google-refresh-token`).digest();
}
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64url")).join(".");
}
export function decifrar(cifrado: string): string {
  const [iv, tag, dados] = cifrado.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", chave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}
