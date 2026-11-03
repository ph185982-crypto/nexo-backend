import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { listarMotivos } from "@/lib/funil/motivos";
import { validarChave } from "@/lib/integracao/chave";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getFunis, POST as postFunil } from "@/app/api/config/funis/route";
import { PATCH as patchFunil, DELETE as delFunil } from "@/app/api/config/funis/[id]/route";
import { POST as postEtapa } from "@/app/api/config/funis/[id]/etapas/route";
import { POST as postReordenar } from "@/app/api/config/funis/[id]/reordenar/route";
import { PATCH as patchEtapa, DELETE as delEtapa } from "@/app/api/config/etapas/[id]/route";
import { GET as getMotivos, POST as postMotivo } from "@/app/api/config/motivos/route";
import { PATCH as patchMotivo } from "@/app/api/config/motivos/[id]/route";
import { GET as getUsuarios, POST as postUsuario } from "@/app/api/config/usuarios/route";
import { PATCH as patchUsuario } from "@/app/api/config/usuarios/[id]/route";
import { GET as getChaves, POST as postChave } from "@/app/api/config/chaves/route";
import { DELETE as delChave } from "@/app/api/config/chaves/[id]/route";
import { PATCH as patchModelo } from "@/app/api/config/modelos/[id]/route";
import { POST as postLogin } from "@/app/api/login/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

async function atores(marca: string) {
  const mk = (papel: string, ativo = true) => prisma.usuario.create({ data: { nome: `${papel} ${marca}`, email: `${papel.toLowerCase()}${ativo ? "" : "x"}${marca}@t.local`, papel, ativo, senhaHash: "x" } });
  const [admin, vend, inativo] = [await mk("ADMIN"), await mk("VENDEDOR"), await mk("ADMIN", false)];
  const cookieDe = async (u: { id: string }) => `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const comoAdmin = await cookieDe(admin), comoVend = await cookieDe(vend), comoInativo = await cookieDe(inativo);
  const req = (cookie: string | null, url: string, metodo = "GET", corpo?: unknown) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const limpar = () => prisma.usuario.deleteMany({ where: { id: { in: [admin.id, vend.id, inativo.id] } } });
  return { admin, vend, inativo, comoAdmin, comoVend, comoInativo, req, limpar };
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

test("só administrador ativo acessa a configuração", async () => {
  const marca = `a${Date.now()}`;
  const a = await atores(marca);
  try {
    const rotas: Array<[string, () => Promise<Response>]> = [
      ["funis", (c = null as string | null) => getFunis(a.req(c, "/x"))] as never, ["usuarios", (c = null as string | null) => getUsuarios(a.req(c, "/x"))] as never,
      ["chaves", (c = null as string | null) => getChaves(a.req(c, "/x"))] as never, ["motivos", (c = null as string | null) => getMotivos(a.req(c, "/x"))] as never,
    ];
    for (const [nome, chamar] of rotas) {
      const f = chamar as unknown as (c: string | null) => Promise<Response>;
      assert.equal((await f(null)).status, 401, `${nome} sem sessão`);
      assert.equal((await f(a.comoVend)).status, 403, `${nome} vendedor`);
      assert.equal((await f(a.comoInativo)).status, 403, `${nome} administrador desativado`);
      assert.equal((await f(a.comoAdmin)).status, 200, `${nome} administrador`);
    }
    assert.equal((await postFunil(a.req(a.comoVend, "/x", "POST", { nome: "Invasor" }))).status, 403);
    assert.equal(await prisma.funil.count({ where: { nome: "Invasor" } }), 0);
    assert.equal((await patchUsuario(a.req(a.comoVend, "/x", "PATCH", { papel: "ADMIN" }), p(a.vend.id))).status, 403, "vendedor não se promove");
    assert.equal((await prisma.usuario.findUnique({ where: { id: a.vend.id } }))!.papel, "VENDEDOR");
  } finally { await a.limpar(); }
});

test("funis: criação com etapas, padrão único, nome duplicado, desativar/excluir protegidos", async () => {
  const marca = `f${Date.now()}`;
  const a = await atores(marca);
  const padraoAntes = await prisma.funil.findFirst({ where: { padrao: true } });
  const criados: string[] = [];
  try {
    const r1 = await postFunil(a.req(a.comoAdmin, "/x", "POST", { nome: `Novo ${marca}` }));
    assert.equal(r1.status, 201);
    const { id } = await r1.json(); criados.push(id);
    const f = (await prisma.funil.findUnique({ where: { id }, include: { etapas: { orderBy: { ordem: "asc" } } } }))!;
    assert.deepEqual(f.etapas.map((e) => [e.nome, e.tipo]), [["Novo", "ABERTA"], ["Em andamento", "ABERTA"], ["Ganha", "GANHA"], ["Perdida", "PERDIDA"]]);
    assert.equal(f.padrao, !padraoAntes, "só vira padrão sozinho se não havia nenhum");
    assert.equal((await postFunil(a.req(a.comoAdmin, "/x", "POST", { nome: `Novo ${marca}` }))).status, 400, "nome duplicado");
    assert.equal((await postFunil(a.req(a.comoAdmin, "/x", "POST", { nome: "  " }))).status, 400);

    // padrão exclusivo
    const r2 = await postFunil(a.req(a.comoAdmin, "/x", "POST", { nome: `Outro ${marca}`, padrao: true }));
    const id2 = (await r2.json()).id; criados.push(id2);
    assert.deepEqual((await prisma.funil.findMany({ where: { padrao: true } })).map((x) => x.id), [id2], "marcar como padrão desmarca os outros");
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(id2))).status, 400, "não desativa o padrão");
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { padrao: false }), p(id2))).status, 400, "não fica sem padrão");
    assert.equal((await delFunil(a.req(a.comoAdmin, "/x", "DELETE"), p(id2))).status, 400, "não exclui o padrão");
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { nome: `Novo ${marca}` }), p(id2))).status, 400, "renomear para nome existente");
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { ordem: -1 }), p(id))).status, 400);
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { nome: "x" }), p("nao-existe"))).status, 404);
    // o primeiro deixa de ser padrão e agora pode ser desativado
    assert.equal((await patchFunil(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(id))).status, 200);
    assert.equal((await prisma.funil.findUnique({ where: { id } }))!.ativo, false);

    // com oportunidades não exclui
    const etapa = f.etapas[0];
    const contato = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: `C ${marca}` } });
    const op = await criarOportunidade({ nome: "dentro", contatoId: contato.id, etapaId: etapa.id });
    assert.equal((await delFunil(a.req(a.comoAdmin, "/x", "DELETE"), p(id))).status, 400);
    await prisma.oportunidade.delete({ where: { id: op.id } }); await prisma.contato.delete({ where: { id: contato.id } });
    assert.equal((await delFunil(a.req(a.comoAdmin, "/x", "DELETE"), p(id))).status, 200);
    assert.equal((await delFunil(a.req(a.comoAdmin, "/x", "DELETE"), p(id))).status, 404);
    criados.splice(criados.indexOf(id), 1);
  } finally {
    await prisma.funil.deleteMany({ where: { id: { in: criados } } });
    await prisma.funil.updateMany({ where: { padrao: true }, data: { padrao: false } });
    if (padraoAntes) await prisma.funil.update({ where: { id: padraoAntes.id }, data: { padrao: true, ativo: true } });
    await a.limpar();
  }
});

test("etapas: criar, validar, natureza travada com oportunidades, última aberta protegida, reordenar exato", async () => {
  const marca = `e${Date.now()}`;
  const a = await atores(marca);
  const c = await cenario();
  try {
    const url = "/x";
    const nova = await postEtapa(a.req(a.comoAdmin, url, "POST", { nome: "Diagnóstico", tipo: "ABERTA", descricao: "AÇÃO: ligar" }), p(c.funil.id));
    assert.equal(nova.status, 201);
    const eid = (await nova.json()).id;
    const ordemNomes = async () => (await prisma.etapa.findMany({ where: { funilId: c.funil.id }, orderBy: { ordem: "asc" } })).map((e) => e.nome);
    assert.deepEqual(await ordemNomes(), ["Leads", "Qualificação", "Proposta e negociação", "Diagnóstico", "Ganha", "Perdida"], "etapa aberta entra antes de Ganha/Perdida, ordens renumeradas");
    assert.deepEqual((await prisma.etapa.findMany({ where: { funilId: c.funil.id }, orderBy: { ordem: "asc" } })).map((e) => e.ordem), [0, 1, 2, 3, 4, 5]);
    const final = await postEtapa(a.req(a.comoAdmin, url, "POST", { nome: "Arquivada", tipo: "PERDIDA" }), p(c.funil.id));
    assert.equal((await ordemNomes()).at(-1), "Arquivada", "etapa final entra no fim");
    await prisma.etapa.delete({ where: { id: (await final.json()).id } });
    assert.equal((await postEtapa(a.req(a.comoAdmin, url, "POST", { nome: "Diagnóstico" }), p(c.funil.id))).status, 400, "nome duplicado no funil");
    assert.equal((await postEtapa(a.req(a.comoAdmin, url, "POST", { nome: "X", tipo: "OUTRA" }), p(c.funil.id))).status, 400);
    assert.equal((await postEtapa(a.req(a.comoAdmin, url, "POST", { nome: "X" }), p("nao-existe"))).status, 404);

    // natureza travada com oportunidade dentro; renomear e descrever pode
    const op = await criarOportunidade({ nome: "dentro", contatoId: c.contato.id, etapaId: c.qualif.id });
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { tipo: "GANHA" }), p(c.qualif.id))).status, 400);
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { nome: "Qualificação 2", descricao: "novo texto" }), p(c.qualif.id))).status, 200);
    assert.deepEqual(await prisma.etapa.findUnique({ where: { id: c.qualif.id }, select: { nome: true, descricao: true } }), { nome: "Qualificação 2", descricao: "novo texto" });
    assert.equal((await delEtapa(a.req(a.comoAdmin, url, "DELETE"), p(c.qualif.id))).status, 400, "etapa com oportunidade não exclui");
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { nome: "Leads" }), p(c.qualif.id))).status, 400, "renomear para nome existente");
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { nome: "x" }), p("nao-existe"))).status, 404);

    // vazia: muda de natureza e exclui, mas nunca a última aberta
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { tipo: "PERDIDA" }), p(eid))).status, 200);
    assert.equal((await delEtapa(a.req(a.comoAdmin, url, "DELETE"), p(eid))).status, 200);
    await prisma.oportunidade.delete({ where: { id: op.id } });
    assert.equal((await delEtapa(a.req(a.comoAdmin, url, "DELETE"), p(c.leads.id))).status, 200);
    assert.equal((await delEtapa(a.req(a.comoAdmin, url, "DELETE"), p(c.proposta.id))).status, 200);
    assert.equal((await patchEtapa(a.req(a.comoAdmin, url, "PATCH", { tipo: "PERDIDA" }), p(c.qualif.id))).status, 400, "última aberta não muda de natureza");
    assert.equal((await delEtapa(a.req(a.comoAdmin, url, "DELETE"), p(c.qualif.id))).status, 400, "última aberta não exclui");

    // reordenar: precisa do conjunto exato
    const ids = (await prisma.etapa.findMany({ where: { funilId: c.funil.id }, orderBy: { ordem: "asc" } })).map((e) => e.id);
    assert.equal(ids.length, 3);
    const ok = await postReordenar(a.req(a.comoAdmin, url, "POST", { etapaIds: [...ids].reverse() }), p(c.funil.id));
    assert.equal(ok.status, 200);
    assert.deepEqual((await prisma.etapa.findMany({ where: { funilId: c.funil.id }, orderBy: { ordem: "asc" } })).map((e) => e.id), [...ids].reverse());
    for (const ruim of [[ids[0]], [...ids, "x"], [ids[0], ids[0], ids[1]], "texto", [1, 2, 3]]) assert.equal((await postReordenar(a.req(a.comoAdmin, url, "POST", { etapaIds: ruim }), p(c.funil.id))).status, 400, JSON.stringify(ruim));
    assert.equal((await postReordenar(a.req(a.comoAdmin, url, "POST", { etapaIds: [] }), p("nao-existe"))).status, 404);
  } finally { await c.limpar(); await a.limpar(); }
});

test("motivos: criar, duplicado, desativar tira da escolha mas preserva o histórico", async () => {
  const marca = `m${Date.now()}`;
  const a = await atores(marca);
  const c = await cenario();
  try {
    const r = await postMotivo(a.req(a.comoAdmin, "/x", "POST", { tipo: "PERDA", nome: `Prazo ${marca}` }));
    assert.equal(r.status, 201);
    const id = (await r.json()).id;
    assert.equal((await postMotivo(a.req(a.comoAdmin, "/x", "POST", { tipo: "PERDA", nome: `Prazo ${marca}` }))).status, 400);
    assert.equal((await postMotivo(a.req(a.comoAdmin, "/x", "POST", { tipo: "OUTRO", nome: "x" }))).status, 400);
    assert.ok((await listarMotivos("PERDA")).some((m) => m.id === id));
    const op = await criarOportunidade({ nome: "usa", contatoId: c.contato.id, funilId: c.funil.id });
    await prisma.oportunidade.update({ where: { id: op.id }, data: { motivoId: id } });
    assert.equal((await patchMotivo(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(id))).status, 200);
    assert.ok(!(await listarMotivos("PERDA")).some((m) => m.id === id), "desativado some da escolha");
    const lista = (await (await getMotivos(a.req(a.comoAdmin, "/x"))).json()).motivos;
    assert.deepEqual(lista.filter((m: { id: string }) => m.id === id).map((m: { ativo: boolean; usos: number }) => [m.ativo, m.usos]), [[false, 1]], "painel mostra desativados e quantos usos");
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.motivoId, id, "histórico intacto");
    assert.equal((await patchMotivo(a.req(a.comoAdmin, "/x", "PATCH", { nome: "Preço" }), p(id))).status, 400, "nome duplicado");
    assert.equal((await patchMotivo(a.req(a.comoAdmin, "/x", "PATCH", { ativo: true }), p("nao-existe"))).status, 404);
  } finally { await prisma.oportunidade.deleteMany({ where: { funilId: c.funil.id } }); await prisma.motivoEncerramento.deleteMany({ where: { nome: { contains: marca } } }); await c.limpar(); await a.limpar(); }
});

test("usuários: senha mínima, e-mail único, último admin e auto-desativação protegidos, redefinir senha", async () => {
  const marca = `u${Date.now()}`;
  const a = await atores(marca);
  const outrosAdmins = await prisma.usuario.findMany({ where: { papel: "ADMIN", ativo: true, id: { not: a.admin.id } }, select: { id: true } });
  const criados: string[] = [];
  try {
    const corpo = { nome: "Nova", email: `nova${marca}@t.local`, senha: "senha-bem-longa-1", papel: "VENDEDOR" };
    assert.equal((await postUsuario(a.req(a.comoAdmin, "/x", "POST", { ...corpo, senha: "curta" }))).status, 400);
    assert.equal((await postUsuario(a.req(a.comoAdmin, "/x", "POST", { ...corpo, email: "sem-arroba" }))).status, 400);
    assert.equal((await postUsuario(a.req(a.comoAdmin, "/x", "POST", { ...corpo, papel: "DONO" }))).status, 400);
    const ok = await postUsuario(a.req(a.comoAdmin, "/x", "POST", corpo));
    assert.equal(ok.status, 201); const id = (await ok.json()).id; criados.push(id);
    assert.equal((await postUsuario(a.req(a.comoAdmin, "/x", "POST", { ...corpo, email: corpo.email.toUpperCase() }))).status, 400, "e-mail duplicado (sem diferenciar caixa)");
    const lista = (await (await getUsuarios(a.req(a.comoAdmin, "/x"))).json()).usuarios;
    assert.ok(lista.every((u: Record<string, unknown>) => !("senhaHash" in u)), "hash nunca sai pela API");

    // o novo usuário consegue entrar; redefinir a senha troca a credencial
    const entrar = (senha: string) => postLogin(new Request("http://x/api/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` }, body: JSON.stringify({ email: corpo.email, senha }) }));
    assert.equal((await entrar("senha-bem-longa-1")).status, 200);
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { senha: "curta" }), p(id))).status, 400);
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { senha: "outra-senha-longa-2" }), p(id))).status, 200);
    assert.equal((await entrar("senha-bem-longa-1")).status, 401);
    assert.equal((await entrar("outra-senha-longa-2")).status, 200);
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(id))).status, 200);
    assert.equal((await entrar("outra-senha-longa-2")).status, 401, "desativado não entra");

    // proteções de administrador
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(a.admin.id))).status, 400, "não se desativa");
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { papel: "VENDEDOR" }), p(a.admin.id))).status, 400, "não se rebaixa");
    await prisma.usuario.updateMany({ where: { id: { in: outrosAdmins.map((u) => u.id) } }, data: { ativo: false } });
    const segundo = await prisma.usuario.create({ data: { nome: "Outro admin", email: `adm2${marca}@t.local`, papel: "ADMIN", senhaHash: "x" } }); criados.push(segundo.id);
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(segundo.id))).status, 200, "com outro admin ativo (eu), pode desativar este");
    await prisma.usuario.update({ where: { id: segundo.id }, data: { ativo: true } });
    const cookie2 = await (async () => `${COOKIE_SESSAO}=${await assinarSessao(segundo.id, process.env.SESSION_SECRET!)}`)();
    await prisma.usuario.update({ where: { id: a.admin.id }, data: { ativo: true } });
    assert.equal((await patchUsuario(a.req(cookie2, "/x", "PATCH", { ativo: false }), p(a.admin.id))).status, 200, "segundo admin desativa o primeiro, sobrando ele");
    assert.equal((await patchUsuario(a.req(cookie2, "/x", "PATCH", { papel: "VENDEDOR" }), p(segundo.id))).status, 400, "e não pode se rebaixar");
    assert.equal((await patchUsuario(a.req(a.comoAdmin, "/x", "PATCH", { nome: "x" }), p("nao-existe"))).status, 403, "primeiro admin foi desativado: perdeu o acesso");
  } finally {
    await prisma.usuario.updateMany({ where: { id: { in: outrosAdmins.map((u) => u.id) } }, data: { ativo: true } });
    await prisma.tentativaLogin.deleteMany({ where: { chave: { startsWith: "email:nova" } } });
    await prisma.usuario.deleteMany({ where: { id: { in: criados } } }); await a.limpar();
  }
});

test("chaves de integração: aparece uma vez, funciona, lista sem segredo, revoga na hora", async () => {
  const marca = `k${Date.now()}`;
  const a = await atores(marca);
  try {
    assert.equal((await postChave(a.req(a.comoAdmin, "/x", "POST", { nome: "" }))).status, 400);
    const r = await postChave(a.req(a.comoAdmin, "/x", "POST", { nome: `Vendedor IA ${marca}` }));
    assert.equal(r.status, 201);
    const { id, chave } = await r.json();
    assert.match(chave, /^avz_live_[a-f0-9]{48}$/);
    const usar = () => validarChave(new Request("http://x", { headers: { authorization: `Bearer ${chave}` } }));
    assert.equal((await usar())?.id, id);
    const lista = await (await getChaves(a.req(a.comoAdmin, "/x"))).json();
    const item = lista.chaves.find((c: { id: string }) => c.id === id);
    assert.deepEqual([JSON.stringify(lista).includes(chave), "hash" in item, item.prefixo.startsWith("avz_live_")], [false, false, true], "lista nunca devolve a chave nem o hash");
    assert.equal((await delChave(a.req(a.comoVend, "/x", "DELETE"), p(id))).status, 403);
    assert.equal((await delChave(a.req(a.comoAdmin, "/x", "DELETE"), p(id))).status, 200);
    assert.equal(await usar(), null, "revogada na hora");
    assert.equal((await delChave(a.req(a.comoAdmin, "/x", "DELETE"), p(id))).status, 404, "já revogada");
  } finally { await prisma.chaveIntegracao.deleteMany({ where: { nome: { contains: marca } } }); await a.limpar(); }
});

test("modelo de entrega: padrão exclusivo e desativar", async () => {
  const marca = `d${Date.now()}`;
  const a = await atores(marca);
  const padraoAntes = await prisma.modeloEntrega.findFirst({ where: { padrao: true } });
  const m1 = await prisma.modeloEntrega.create({ data: { nome: `M1 ${marca}` } });
  const m2 = await prisma.modeloEntrega.create({ data: { nome: `M2 ${marca}` } });
  try {
    assert.equal((await patchModelo(a.req(a.comoVend, "/x", "PATCH", { padrao: true }), p(m1.id))).status, 403);
    assert.equal((await patchModelo(a.req(a.comoAdmin, "/x", "PATCH", { padrao: true }), p("nao-existe"))).status, 404);
    await patchModelo(a.req(a.comoAdmin, "/x", "PATCH", { padrao: true }), p(m1.id));
    await patchModelo(a.req(a.comoAdmin, "/x", "PATCH", { padrao: true }), p(m2.id));
    assert.deepEqual((await prisma.modeloEntrega.findMany({ where: { padrao: true } })).map((m) => m.id), [m2.id]);
    await patchModelo(a.req(a.comoAdmin, "/x", "PATCH", { ativo: false }), p(m2.id));
    const dep = (await prisma.modeloEntrega.findUnique({ where: { id: m2.id } }))!;
    assert.deepEqual([dep.ativo, dep.padrao], [false, false], "desativar também tira de padrão");
  } finally {
    await prisma.modeloEntrega.deleteMany({ where: { id: { in: [m1.id, m2.id] } } });
    if (padraoAntes) await prisma.modeloEntrega.update({ where: { id: padraoAntes.id }, data: { padrao: true, ativo: true } });
    await a.limpar();
  }
});
