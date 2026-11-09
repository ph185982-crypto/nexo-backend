// Volta do consentimento do Google: confere o state, troca o código, guarda o refresh token cifrado.
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { ESCOPOS, cifrar, emailDoIdToken, enderecoDeRetorno, trocarCodigo } from "@/lib/google/cliente";

export const dynamic = "force-dynamic";

const voltar = (req: Request, resultado: string) => new Response(null, {
  status: 303,
  headers: { location: new URL(`/configuracao?aba=google&google=${resultado}`, req.url).toString(), "set-cookie": "google_oauth_state=; Path=/api/google; Max-Age=0" },
});

function igual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return voltar(req, "cancelado");
  const code = u.searchParams.get("code"), state = u.searchParams.get("state") ?? "";
  const cookie = /(?:^|;\s*)google_oauth_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  if (!code || !state || !cookie || !igual(state, cookie)) return voltar(req, "erro_state");
  try {
    const t = await trocarCodigo(code, enderecoDeRetorno(req));
    const concedidos = new Set((t.scope ?? "").split(" "));
    // A pessoa pode desmarcar permissões na tela do Google: sem Agenda e Meet a integração não funciona.
    if (!ESCOPOS.filter((e) => e.startsWith("https://")).every((e) => concedidos.has(e))) return voltar(req, "escopos");
    const atual = await prisma.contaGoogle.findUnique({ where: { usuarioId: uid }, select: { refreshTokenCifrado: true } });
    const refresh = t.refresh_token ? cifrar(t.refresh_token) : atual?.refreshTokenCifrado;
    if (!refresh) return voltar(req, "sem_refresh");
    const dados = {
      email: emailDoIdToken(t.id_token) ?? "conta Google", refreshTokenCifrado: refresh, accessToken: t.access_token,
      accessExpiraEm: new Date(Date.now() + t.expires_in * 1000), escopos: t.scope ?? "", ativa: true, erro: null,
    };
    await prisma.contaGoogle.upsert({ where: { usuarioId: uid }, create: { usuarioId: uid, ...dados }, update: dados });
    return voltar(req, "ok");
  } catch (e) {
    console.error("[google/callback]", e);
    return voltar(req, "erro_token");
  }
}
