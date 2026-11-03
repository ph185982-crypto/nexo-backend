import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assinarSessao, COOKIE_SESSAO, DURACAO_SESSAO_S, segredoDaSessao } from "@/lib/auth/sessao";

const JANELA_MS = 15 * 60_000;
const LIMITE_EMAIL = 10;
const LIMITE_IP = 30;
// Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails existem).
const HASH_FALSO = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e8w4cYbT0nWkz0nS8f0m0k5b1l2yK";

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { email?: string; senha?: string } | null;
  const email = corpo?.email?.trim().toLowerCase() ?? "";
  const senha = corpo?.senha ?? "";
  if (!email || !senha || email.length > 200 || senha.length > 200) return Response.json({ erro: "Informe e-mail e senha" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconhecido";
  const desde = new Date(Date.now() - JANELA_MS);
  const [porEmail, porIp] = await Promise.all([
    prisma.tentativaLogin.count({ where: { chave: `email:${email}`, criadaEm: { gte: desde } } }),
    prisma.tentativaLogin.count({ where: { chave: `ip:${ip}`, criadaEm: { gte: desde } } }),
  ]);
  if (porEmail >= LIMITE_EMAIL || porIp >= LIMITE_IP) return Response.json({ erro: "Muitas tentativas. Tente de novo em 15 minutos." }, { status: 429 });

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const ok = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_FALSO);
  if (!usuario || !usuario.ativo || !ok) {
    await prisma.tentativaLogin.createMany({ data: [{ chave: `email:${email}` }, { chave: `ip:${ip}` }] });
    await prisma.tentativaLogin.deleteMany({ where: { criadaEm: { lt: new Date(Date.now() - 24 * 3_600_000) } } }); // não deixa a tabela crescer
    return Response.json({ erro: "E-mail ou senha incorretos" }, { status: 401 });
  }
  await prisma.tentativaLogin.deleteMany({ where: { chave: `email:${email}` } });

  const token = await assinarSessao(usuario.id, segredoDaSessao());
  const seguro = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true, nome: usuario.nome }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${COOKIE_SESSAO}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO_SESSAO_S}${seguro}`,
    },
  });
}
