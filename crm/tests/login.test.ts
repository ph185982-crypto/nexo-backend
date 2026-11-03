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

test("sessão de usuário desativado ou removido para de valer na API (não só na tela)", async () => {
  const { usuarioDaRequisicao, invalidarCacheUsuario } = await import("@/lib/auth/requisicao");
  const { assinarSessao } = await import("@/lib/auth/sessao");
  const u = await prisma.usuario.create({ data: { nome: "Saiu", email: `saiu${Date.now()}@teste.local`, senhaHash: "x" } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const req = () => new Request("http://x", { headers: { cookie } });
  try {
    assert.equal(await usuarioDaRequisicao(req()), u.id);
    await prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
    assert.equal(await usuarioDaRequisicao(req()), u.id, "dentro da janela do cache ainda vale (10 s)");
    invalidarCacheUsuario(u.id);
    assert.equal(await usuarioDaRequisicao(req()), null, "desativado: cookie assinado não vale mais");
    await prisma.usuario.update({ where: { id: u.id }, data: { ativo: true } });
    invalidarCacheUsuario(u.id);
    assert.equal(await usuarioDaRequisicao(req()), u.id, "reativado volta a valer");
    await prisma.usuario.delete({ where: { id: u.id } });
    invalidarCacheUsuario(u.id);
    assert.equal(await usuarioDaRequisicao(req()), null, "removido: não vale");
  } finally { await prisma.usuario.deleteMany({ where: { id: u.id } }); }
});

test("login: tentativas com mais de 24 h são apagadas (a tabela não cresce para sempre)", async () => {
  const email = `purga${Date.now()}@teste.local`;
  const velha = await prisma.tentativaLogin.create({ data: { chave: `email:${email}`, criadaEm: new Date(Date.now() - 30 * 3_600_000) } });
  const recente = await prisma.tentativaLogin.create({ data: { chave: `email:${email}`, criadaEm: new Date(Date.now() - 3_600_000) } });
  const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  try {
    assert.equal((await login(post({ email, senha: "errada" }, ip))).status, 401);
    assert.equal(await prisma.tentativaLogin.findUnique({ where: { id: velha.id } }), null, "a de 30 h foi apagada");
    assert.ok(await prisma.tentativaLogin.findUnique({ where: { id: recente.id } }), "a de 1 h continua valendo para o limite");
  } finally { await prisma.tentativaLogin.deleteMany({ where: { OR: [{ chave: `email:${email}` }, { chave: `ip:${ip}` }] } }); }
});
