// Login único (Avanteza ID): verificação do token e a rota /api/sso/callback.
// O teste gera um par de chaves P-256, assina os tokens e injeta a chave pública (nada de rede).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authorizeUrl, caminhoInterno, centralUrl, definirChavesAvanteza, verifyAvantezaToken, type ChaveJwk } from "@/lib/avanteza-sso";
import { GET as callback } from "@/app/api/sso/callback/route";
import { COOKIE_SESSAO, verificarSessao } from "@/lib/auth/sessao";
import { usuarioDaRequisicao } from "@/lib/auth/requisicao";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

const KID = "teste-1";
const par = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const outroPar = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk: ChaveJwk = { ...(par.publicKey.export({ format: "jwk" }) as ChaveJwk), kid: KID, use: "sig", alg: "ES256" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const agora = () => Math.floor(Date.now() / 1000);

function assinar(claims: Record<string, unknown> = {}, opcoes: { header?: Record<string, unknown>; chave?: crypto.KeyObject } = {}) {
  const header = b64({ alg: "ES256", typ: "JWT", kid: KID, ...opcoes.header });
  const corpo = b64({ iss: "avanteza-id", aud: "crm", sub: "pessoa@avanteza.com.br", name: "Pessoa Teste", role: "member", ret: "/", iat: agora(), exp: agora() + 60, jti: crypto.randomUUID(), ...claims });
  const assinatura = crypto.sign("sha256", Buffer.from(`${header}.${corpo}`), { key: opcoes.chave ?? par.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${corpo}.${assinatura.toString("base64url")}`;
}
const verificar = (token: string, audience = "crm") => verifyAvantezaToken(token, { audience, keys: [jwk] });

test("sso: token válido devolve e-mail em minúsculas, nome, papel e caminho de volta", async () => {
  const u = await verificar(assinar({ sub: "Maria@Avanteza.com.br", name: "Maria", role: "admin", ret: "/tarefas?x=1" }));
  assert.deepEqual({ email: u.email, name: u.name, role: u.role, returnTo: u.returnTo }, { email: "maria@avanteza.com.br", name: "Maria", role: "admin", returnTo: "/tarefas?x=1" });
});

test("sso: audience errada, expirado, emissor errado, sem usuário e sem audience são recusados", async () => {
  await assert.rejects(verificar(assinar({ aud: "vendas" })), /outro aplicativo/);
  await assert.rejects(verificar(assinar(), "vendas"), /outro aplicativo/);
  await assert.rejects(verificar(assinar({ exp: agora() - 30 })), /expirado/);
  await assert.rejects(verificar(assinar({ exp: undefined })), /expirado/, "sem validade não vale");
  await assert.rejects(verificar(assinar({ iss: "outro-emissor" })), /emissor/);
  await assert.rejects(verificar(assinar({ iat: agora() + 3600, exp: agora() + 3660 })), /futuro/);
  await assert.rejects(verificar(assinar({ sub: "" })), /sem usuário/);
  await assert.rejects(verifyAvantezaToken(assinar(), { keys: [jwk] }), /audience/);
});

test("sso: assinatura adulterada, chave de outro par, kid desconhecido e alg diferente de ES256 são recusados", async () => {
  const bom = assinar();
  const [h, , s] = bom.split(".");
  const corpoTrocado = b64({ iss: "avanteza-id", aud: "crm", sub: "intruso@x.com", role: "admin", exp: agora() + 60 });
  await assert.rejects(verificar(`${h}.${corpoTrocado}.${s}`), /assinatura/, "corpo trocado com a assinatura antiga");
  const sBytes = Buffer.from(s, "base64url"); sBytes[10] ^= 0xff;
  await assert.rejects(verificar(`${bom.split(".").slice(0, 2).join(".")}.${sBytes.toString("base64url")}`), /assinatura/);
  await assert.rejects(verificar(assinar({}, { chave: outroPar.privateKey })), /assinatura/, "assinado por outra chave com o mesmo kid");
  await assert.rejects(verificar(assinar({}, { header: { kid: "nao-existe" } })), /chave desconhecida/);

  // alg none: sem assinatura, com assinatura vazia e com a assinatura de outro token
  const none = b64({ alg: "none", typ: "JWT", kid: KID });
  const corpo = bom.split(".")[1];
  for (const t of [`${none}.${corpo}.`, `${none}.${corpo}.${s}`, `${none}.${corpo}`]) await assert.rejects(verificar(t), /algoritmo|malformado/);
  // confusão de algoritmo: HS256 usando a chave pública como segredo
  const hs = b64({ alg: "HS256", typ: "JWT", kid: KID });
  const mac = crypto.createHmac("sha256", JSON.stringify(jwk)).update(`${hs}.${corpo}`).digest("base64url");
  await assert.rejects(verificar(`${hs}.${corpo}.${mac}`), /algoritmo/);
  for (const lixo of ["", "abc", "a.b.c", null, undefined]) await assert.rejects(verifyAvantezaToken(lixo, { audience: "crm", keys: [jwk] }));
});

test("sso: caminho de volta só interno; endereços da Central vêm de AVANTEZA_HUB_URL", async () => {
  for (const ret of ["https://malicioso.com", "//malicioso.com", "malicioso", 42, undefined]) {
    assert.equal((await verificar(assinar({ ret }))).returnTo, "/", String(ret));
  }
  assert.equal(caminhoInterno("/\\malicioso.com"), "/");
  assert.equal(caminhoInterno("/contatos/1"), "/contatos/1");

  const antes = process.env.AVANTEZA_HUB_URL;
  try {
    delete process.env.AVANTEZA_HUB_URL;
    assert.equal(authorizeUrl("crm", "/tarefas?a=1"), "https://app.avanteza.com.br/sso/authorize?app=crm&return=%2Ftarefas%3Fa%3D1");
    assert.equal(centralUrl(), "https://app.avanteza.com.br/central");
    process.env.AVANTEZA_HUB_URL = "https://central.teste.local/";
    assert.equal(authorizeUrl("crm"), "https://central.teste.local/sso/authorize?app=crm&return=%2F");
  } finally {
    if (antes === undefined) delete process.env.AVANTEZA_HUB_URL; else process.env.AVANTEZA_HUB_URL = antes;
  }
});

// ─── Rota de volta ────────────────────────────────────────────────────────────
const chamar = (token: string) => callback(new Request(`https://crm.teste.local/api/sso/callback?token=${encodeURIComponent(token)}`));
const cookieDe = (r: Response) => new RegExp(`${COOKIE_SESSAO}=([^;]+)`).exec(r.headers.get("set-cookie") ?? "")?.[1];

test("callback: cria o usuário na primeira entrada (admin → ADMIN, demais → VENDEDOR) e abre a sessão local", async () => {
  definirChavesAvanteza([jwk]);
  const marca = `sso${Date.now()}`;
  const emails = [`adm-${marca}@teste.local`, `mem-${marca}@teste.local`, `rev-${marca}@teste.local`];
  try {
    const r = await chamar(assinar({ sub: emails[0].toUpperCase(), name: "Admin Novo", role: "admin", ret: "/relatorios" }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "https://crm.teste.local/relatorios");
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(r.headers.get("set-cookie")!, /SameSite=Lax/);
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.deepEqual({ nome: admin.nome, papel: admin.papel, ativo: admin.ativo }, { nome: "Admin Novo", papel: "ADMIN", ativo: true });
    assert.match(admin.senhaHash, /^\$2[aby]\$10\$/, "senha aleatória guardada só como hash bcrypt");
    assert.equal(await bcrypt.compare("", admin.senhaHash), false);
    // o cookie é a mesma sessão do login por senha
    const token = cookieDe(r)!;
    assert.equal((await verificarSessao(token, process.env.SESSION_SECRET!))?.uid, admin.id);
    assert.equal(await usuarioDaRequisicao(new Request("http://x", { headers: { cookie: `${COOKIE_SESSAO}=${token}` } })), admin.id);

    await chamar(assinar({ sub: emails[1], name: "", role: "member" }));
    await chamar(assinar({ sub: emails[2], name: "Revisora", role: "reviewer" }));
    const [membro, revisor] = await Promise.all(emails.slice(1).map((email) => prisma.usuario.findUniqueOrThrow({ where: { email } })));
    assert.equal(membro.papel, "VENDEDOR");
    assert.equal(membro.nome, `mem-${marca}`, "sem nome no token: usa o começo do e-mail");
    assert.equal(revisor.papel, "VENDEDOR", "papel desconhecido do CRM entra como o mais restrito");
  } finally {
    await prisma.usuario.deleteMany({ where: { email: { in: emails } } });
    definirChavesAvanteza(null);
  }
});

test("callback: associa ao usuário que já existe (sem diferenciar maiúsculas) sem duplicar nem mudar papel ou senha", async () => {
  definirChavesAvanteza([jwk]);
  const email = `Existe${Date.now()}@Teste.local`;
  const u = await prisma.usuario.create({ data: { nome: "Já Existe", email, senhaHash: await bcrypt.hash("senha-antiga-123", 4), papel: "VENDEDOR" } });
  try {
    const r = await chamar(assinar({ sub: email.toLowerCase(), name: "Outro Nome", role: "admin", ret: "//malicioso.com" }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "https://crm.teste.local/", "caminho de volta externo vira /");
    assert.equal((await verificarSessao(cookieDe(r), process.env.SESSION_SECRET!))?.uid, u.id);
    const todos = await prisma.usuario.findMany({ where: { email: { equals: email, mode: "insensitive" } } });
    assert.equal(todos.length, 1);
    assert.deepEqual({ nome: todos[0].nome, papel: todos[0].papel }, { nome: "Já Existe", papel: "VENDEDOR" }, "papel local não é promovido pela Central");
    assert.equal(await bcrypt.compare("senha-antiga-123", todos[0].senhaHash), true, "a senha de reserva continua valendo");
  } finally {
    await prisma.usuario.deleteMany({ where: { id: u.id } });
    definirChavesAvanteza(null);
  }
});

test("callback: usuário desativado é recusado; token inválido não cria usuário nem sessão", async () => {
  definirChavesAvanteza([jwk]);
  const email = `off${Date.now()}@teste.local`;
  const novo = `nunca${Date.now()}@teste.local`;
  const u = await prisma.usuario.create({ data: { nome: "Saiu", email, senhaHash: "x", ativo: false } });
  try {
    const off = await chamar(assinar({ sub: email }));
    assert.equal(off.status, 302);
    assert.equal(off.headers.get("location"), "https://crm.teste.local/login?erro=sso-desativado");
    assert.equal(off.headers.get("set-cookie"), null);

    const ruins = [
      assinar({ sub: novo, aud: "vendas" }),
      assinar({ sub: novo, exp: agora() - 30 }),
      assinar({ sub: novo }, { chave: outroPar.privateKey }),
      `${b64({ alg: "none", kid: KID })}.${assinar({ sub: novo }).split(".")[1]}.`,
      "",
    ];
    for (const t of ruins) {
      const r = await chamar(t);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), "https://crm.teste.local/login?erro=sso", "mensagem curta, sem detalhe técnico no endereço");
      assert.equal(r.headers.get("set-cookie"), null);
    }
    assert.equal(await prisma.usuario.count({ where: { email: novo } }), 0);
  } finally {
    await prisma.usuario.deleteMany({ where: { OR: [{ id: u.id }, { email: novo }] } });
    definirChavesAvanteza(null);
  }
});

test("middleware: /api/sso/callback passa sem sessão; página protegida vai ao login guardando o caminho pedido", async () => {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  const livre = await middleware(new NextRequest("https://crm.teste.local/api/sso/callback?token=x"));
  assert.equal(livre.headers.get("x-middleware-next"), "1", "a rota de volta não é barrada");
  const api = await middleware(new NextRequest("https://crm.teste.local/api/tarefas"));
  assert.equal(api.status, 401);
  const pagina = await middleware(new NextRequest("https://crm.teste.local/contatos/abc?aba=2"));
  assert.equal(pagina.headers.get("location"), "https://crm.teste.local/login?voltar=%2Fcontatos%2Fabc%3Faba%3D2");
  const raiz = await middleware(new NextRequest("https://crm.teste.local/"));
  assert.equal(raiz.headers.get("location"), "https://crm.teste.local/login");
});
