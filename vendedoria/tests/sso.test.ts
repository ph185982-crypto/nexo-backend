// Login único (Avanteza ID): verificação do token, provider "avanteza-sso" e provisionamento do usuário.
// O teste gera um par de chaves P-256, assina os tokens e injeta a chave pública (nada de rede).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { authorizeUrl, caminhoInterno, centralUrl, definirChavesAvanteza, verifyAvantezaToken, type ChaveJwk } from "@/lib/avanteza-sso";

const temBanco = Boolean(process.env.DATABASE_URL);
const KID = "teste-1";
const par = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const outroPar = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk: ChaveJwk = { ...(par.publicKey.export({ format: "jwk" }) as ChaveJwk), kid: KID, use: "sig", alg: "ES256" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const agora = () => Math.floor(Date.now() / 1000);

function assinar(claims: Record<string, unknown> = {}, opcoes: { header?: Record<string, unknown>; chave?: crypto.KeyObject } = {}) {
  const header = b64({ alg: "ES256", typ: "JWT", kid: KID, ...opcoes.header });
  const corpo = b64({ iss: "avanteza-id", aud: "vendas", sub: "pessoa@avanteza.com.br", name: "Pessoa Teste", role: "member", ret: "/", iat: agora(), exp: agora() + 60, jti: crypto.randomUUID(), ...claims });
  const assinatura = crypto.sign("sha256", Buffer.from(`${header}.${corpo}`), { key: opcoes.chave ?? par.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${corpo}.${assinatura.toString("base64url")}`;
}
const verificar = (token: string, audience = "vendas") => verifyAvantezaToken(token, { audience, keys: [jwk] });

test("sso: token válido devolve e-mail em minúsculas, nome, papel e caminho de volta", async () => {
  const u = await verificar(assinar({ sub: "Maria@Avanteza.com.br", name: "Maria", role: "admin", ret: "/crm/lead/kanban?x=1" }));
  assert.deepEqual({ email: u.email, name: u.name, role: u.role, returnTo: u.returnTo }, { email: "maria@avanteza.com.br", name: "Maria", role: "admin", returnTo: "/crm/lead/kanban?x=1" });
});

test("sso: audience errada, expirado, emissor errado, sem usuário e sem audience são recusados", async () => {
  await assert.rejects(verificar(assinar({ aud: "crm" })), /outro aplicativo/);
  await assert.rejects(verificar(assinar(), "crm"), /outro aplicativo/);
  await assert.rejects(verificar(assinar({ exp: agora() - 30 })), /expirado/);
  await assert.rejects(verificar(assinar({ exp: undefined })), /expirado/, "sem validade não vale");
  await assert.rejects(verificar(assinar({ iss: "outro-emissor" })), /emissor/);
  await assert.rejects(verificar(assinar({ iat: agora() + 3600, exp: agora() + 3660 })), /futuro/);
  await assert.rejects(verificar(assinar({ sub: "" })), /sem usuário/);
  await assert.rejects(verifyAvantezaToken(assinar(), { keys: [jwk] }), /audience/);
});

test("sso: assinatura adulterada, chave de outro par, kid desconhecido e alg diferente de ES256 são recusados", async () => {
  const bom = assinar();
  const [h, corpo, s] = bom.split(".");
  const corpoTrocado = b64({ iss: "avanteza-id", aud: "vendas", sub: "intruso@x.com", role: "admin", exp: agora() + 60 });
  await assert.rejects(verificar(`${h}.${corpoTrocado}.${s}`), /assinatura/, "corpo trocado com a assinatura antiga");
  const sBytes = Buffer.from(s, "base64url"); sBytes[10] ^= 0xff;
  await assert.rejects(verificar(`${h}.${corpo}.${sBytes.toString("base64url")}`), /assinatura/);
  await assert.rejects(verificar(assinar({}, { chave: outroPar.privateKey })), /assinatura/, "assinado por outra chave com o mesmo kid");
  await assert.rejects(verificar(assinar({}, { header: { kid: "nao-existe" } })), /chave desconhecida/);

  // alg none: sem assinatura, com assinatura vazia e com a assinatura de outro token
  const none = b64({ alg: "none", typ: "JWT", kid: KID });
  for (const t of [`${none}.${corpo}.`, `${none}.${corpo}.${s}`, `${none}.${corpo}`]) await assert.rejects(verificar(t), /algoritmo|malformado/);
  // confusão de algoritmo: HS256 usando a chave pública como segredo
  const hs = b64({ alg: "HS256", typ: "JWT", kid: KID });
  const mac = crypto.createHmac("sha256", JSON.stringify(jwk)).update(`${hs}.${corpo}`).digest("base64url");
  await assert.rejects(verificar(`${hs}.${corpo}.${mac}`), /algoritmo/);
  for (const lixo of ["", "abc", "a.b.c", null, undefined]) await assert.rejects(verifyAvantezaToken(lixo, { audience: "vendas", keys: [jwk] }));
});

test("sso: caminho de volta só interno; endereços da Central vêm de AVANTEZA_HUB_URL", async () => {
  for (const ret of ["https://malicioso.com", "//malicioso.com", "malicioso", 42, undefined]) {
    assert.equal((await verificar(assinar({ ret }))).returnTo, "/", String(ret));
  }
  assert.equal(caminhoInterno("/\\malicioso.com"), "/");
  assert.equal(caminhoInterno("/crm/calendar"), "/crm/calendar");

  const antes = process.env.AVANTEZA_HUB_URL;
  try {
    delete process.env.AVANTEZA_HUB_URL;
    assert.equal(authorizeUrl("vendas", "/crm/calendar?a=1"), "https://app.avanteza.com.br/sso/authorize?app=vendas&return=%2Fcrm%2Fcalendar%3Fa%3D1");
    assert.equal(centralUrl(), "https://app.avanteza.com.br/central");
    process.env.AVANTEZA_HUB_URL = "https://central.teste.local/";
    assert.equal(authorizeUrl("vendas"), "https://central.teste.local/sso/authorize?app=vendas&return=%2F");
  } finally {
    if (antes === undefined) delete process.env.AVANTEZA_HUB_URL; else process.env.AVANTEZA_HUB_URL = antes;
  }
});

test("sso: /api/sso/callback não é barrada pelo middleware; o resto continua fechado", async () => {
  const { decidirAcessoApi } = await import("@/lib/auth/rotas-publicas");
  const H = { get: () => null };
  assert.equal(decidirAcessoApi("/api/sso/callback", false, H), "permitir");
  assert.equal(decidirAcessoApi("/api/sso/central", false, H), "permitir");
  assert.equal(decidirAcessoApi("/api/sso", false, H), "negar");
  assert.equal(decidirAcessoApi("/api/ssoutra", false, H), "negar");
  assert.equal(decidirAcessoApi("/api/admin/setup-user", false, H), "negar", "rota removida não volta a ser pública");
});

test("sso: o provider avanteza-sso está registrado ao lado do de senha", async () => {
  // Lê o código (como tests/marca.test.ts): importar lib/auth abriria o Prisma, que exige DATABASE_URL.
  const fs = await import("node:fs");
  const fonte = fs.readFileSync("src/lib/auth/index.ts", "utf8");
  assert.equal(fonte.match(/Credentials\(\{/g)?.length, 2, "dois providers Credentials");
  assert.match(fonte, /name: "credentials"/, "o de senha continua lá");
  assert.match(fonte, /id: PROVIDER_SSO/);
  assert.match(fs.readFileSync("src/lib/auth/sso.ts", "utf8"), /PROVIDER_SSO = "avanteza-sso"/);
});

test("provider avanteza-sso: cria o usuário na primeira entrada (admin → ADMIN, demais → SELLER)", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { autorizarSso } = await import("@/lib/auth/sso");
  const bcrypt = (await import("bcryptjs")).default;
  definirChavesAvanteza([jwk]);
  const marca = `sso${Date.now()}`;
  const emails = [`adm-${marca}@teste.local`, `mem-${marca}@teste.local`, `rev-${marca}@teste.local`];
  try {
    const admin = await autorizarSso(assinar({ sub: emails[0].toUpperCase(), name: "Admin Novo", role: "admin" }));
    assert.deepEqual({ name: admin?.name, email: admin?.email, role: admin?.role }, { name: "Admin Novo", email: emails[0], role: "ADMIN" });
    const salvo = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.equal(salvo.id, admin?.id);
    assert.match(salvo.password ?? "", /^\$2[aby]\$10\$/, "senha aleatória guardada só como hash bcrypt");
    assert.equal(await bcrypt.compare("", salvo.password!), false);

    const membro = await autorizarSso(assinar({ sub: emails[1], name: "", role: "member" }));
    assert.deepEqual({ name: membro?.name, role: membro?.role }, { name: `mem-${marca}`, role: "SELLER" });
    const revisor = await autorizarSso(assinar({ sub: emails[2], role: "reviewer" }));
    assert.equal(revisor?.role, "SELLER", "papel que o app não conhece entra como o mais restrito");
    assert.equal((await autorizarSso(assinar({ sub: emails[1], role: "admin" })))?.id, membro?.id, "segunda entrada usa o mesmo usuário");
    assert.equal(await prisma.user.count({ where: { email: { in: emails } } }), 3);
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    definirChavesAvanteza(null);
    await prisma.$disconnect();
  }
});

test("provider avanteza-sso: associa a quem já existe sem mudar papel nem senha; token inválido não entra nem cria", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { autorizarSso } = await import("@/lib/auth/sso");
  const bcrypt = (await import("bcryptjs")).default;
  definirChavesAvanteza([jwk]);
  const email = `Existe${Date.now()}@Teste.local`;
  const novo = `nunca${Date.now()}@teste.local`;
  const u = await prisma.user.create({ data: { name: "Já Existe", email, password: await bcrypt.hash("senha-antiga-123", 4), role: "MANAGER" } });
  try {
    const r = await autorizarSso(assinar({ sub: email.toLowerCase(), name: "Outro Nome", role: "admin" }));
    assert.deepEqual(r, { id: u.id, name: "Já Existe", email, role: "MANAGER" }, "papel local não é promovido pela Central");
    const todos = await prisma.user.findMany({ where: { email: { equals: email, mode: "insensitive" } } });
    assert.equal(todos.length, 1);
    assert.equal(await bcrypt.compare("senha-antiga-123", todos[0].password!), true, "a senha de reserva continua valendo");

    const ruins = [
      assinar({ sub: novo, aud: "crm" }),
      assinar({ sub: novo, exp: agora() - 30 }),
      assinar({ sub: novo }, { chave: outroPar.privateKey }),
      `${b64({ alg: "none", kid: KID })}.${assinar({ sub: novo }).split(".")[1]}.`,
      "", undefined, 42,
    ];
    for (const t of ruins) assert.equal(await autorizarSso(t), null);
    assert.equal(await prisma.user.count({ where: { email: novo } }), 0);
  } finally {
    await prisma.user.deleteMany({ where: { OR: [{ id: u.id }, { email: novo }] } });
    definirChavesAvanteza(null);
    await prisma.$disconnect();
  }
});
