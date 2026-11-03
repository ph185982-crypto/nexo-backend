import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { POST as login } from "@/app/api/login/route";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/auth/sessao";
import { usuarioDaRequisicao } from "@/lib/auth/requisicao";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const post = (corpo: unknown, ip = "9.9.9.9") =>
  new Request("http://x/api/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(corpo) });

test("login: sucesso devolve cookie de sessão válido; senha errada e limite de tentativas", async () => {
  const email = `login${Date.now()}@teste.local`;
  const u = await prisma.usuario.create({ data: { nome: "Teste", email, senhaHash: await bcrypt.hash("senha-certa-123", 4) } });
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  try {
    const ruim = await login(post({ email, senha: "errada" }, ip));
    assert.equal(ruim.status, 401);
    assert.equal(ruim.headers.get("set-cookie"), null);
    assert.equal((await login(post({ email: "naoexiste@x.com", senha: "qualquer" }, ip))).status, 401, "e-mail inexistente responde igual");
    assert.equal((await login(post({ email: "" , senha: "" }, ip))).status, 400);

    const ok = await login(post({ email: email.toUpperCase(), senha: "senha-certa-123" }, ip));
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const token = new RegExp(`${COOKIE_SESSAO}=([^;]+)`).exec(cookie)![1];
    assert.equal((await verificarSessao(token, process.env.SESSION_SECRET!))?.uid, u.id);
    assert.equal(await usuarioDaRequisicao(new Request("http://x", { headers: { cookie: `${COOKIE_SESSAO}=${token}` } })), u.id);
    assert.equal(await usuarioDaRequisicao(new Request("http://x")), null);

    // 10 falhas seguidas bloqueiam, mesmo com a senha certa
    for (let i = 0; i < 10; i++) await login(post({ email, senha: "errada" }, ip));
    assert.equal((await login(post({ email, senha: "senha-certa-123" }, ip))).status, 429);
  } finally {
    await prisma.tentativaLogin.deleteMany({ where: { OR: [{ chave: `email:${email}` }, { chave: `ip:${ip}` }] } });
    await prisma.usuario.delete({ where: { id: u.id } });
  }
});
