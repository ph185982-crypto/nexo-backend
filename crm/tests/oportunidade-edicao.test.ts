// Edição da oportunidade (com registro na linha do tempo) e produtos (valores calculados pelas linhas).
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { editarOportunidade, lerTags, validarEdicaoOportunidade } from "@/lib/oportunidades/edicao";
import { adicionarLinha, editarLinha, removerLinha, totaisDasLinhas, validarLinha, valorDaLinha } from "@/lib/oportunidades/produtos";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getOp, PATCH as patchOp } from "@/app/api/oportunidades/[id]/route";
import { POST as postProduto } from "@/app/api/oportunidades/[id]/produtos/route";
import { POST as postCatalogo } from "@/app/api/produtos/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

async function preparar() {
  const c = await cenario();
  const dono = await prisma.usuario.create({ data: { nome: `Dono ${c.marca}`, email: `ed-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const outro = await prisma.usuario.create({ data: { nome: `Outro ${c.marca}`, email: `ed2-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4), papel: "VENDEDOR" } });
  const op = await criarOportunidade({ nome: "Consultoria", contatoId: c.contato.id, funilId: c.funil.id, responsavelId: dono.id, valorUnico: 1000 });
  const limpar = async () => {
    await c.limpar();
    await prisma.produto.deleteMany({ where: { nome: { contains: c.marca } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [dono.id, outro.id] } } });
  };
  return { ...c, dono, outro, op, limpar };
}

test("valor da linha e totais por recorrência", () => {
  assert.equal(valorDaLinha({ quantidade: 2, valorUnitario: 1500, desconto: 10 }), 2700);
  assert.deepEqual(totaisDasLinhas([
    { quantidade: 1, valorUnitario: 5000, desconto: 0, recorrencia: "UNICO" },
    { quantidade: 1, valorUnitario: 2000, desconto: 0, recorrencia: "MENSAL" },
    { quantidade: 3, valorUnitario: 100, desconto: 50, recorrencia: "MENSAL" },
  ]), { valorUnico: 5000, valorMensal: 2150 });
  assert.deepEqual(lerTags("#vip, indicação,vip, "), ["vip", "indicação"]);
});

test("editar registra o antes e o depois na linha do tempo e só o que mudou", async () => {
  const p = await preparar();
  try {
    const e = validarEdicaoOportunidade({ nome: "Consultoria anual", probabilidade: "QUENTE", finalizaEm: "2026-12-20", responsavelId: p.outro.id, tags: "vip", valorUnico: "1500,50" });
    const r = await editarOportunidade(p.op.id, e, { id: p.dono.id, nome: "Dono" });
    assert.equal(r?.mudancas.length, 6);
    const op = await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } });
    assert.equal(op.nome, "Consultoria anual");
    assert.equal(Number(op.valorUnico), 1500.5);
    assert.equal(op.responsavelId, p.outro.id);
    assert.deepEqual(op.tags, ["vip"]);
    assert.equal(op.finalizaEm?.toISOString(), "2026-12-20T21:00:00.000Z"); // 18h de Brasília
    const f = await prisma.feedback.findFirstOrThrow({ where: { oportunidadeId: p.op.id, tipo: "SISTEMA" } });
    assert.match(f.texto, /Probabilidade: — → Quente/);
    assert.match(f.texto, /Responsável: Dono .* → Outro/);

    // prorrogar: data maior vira "Prorrogou"
    await editarOportunidade(p.op.id, validarEdicaoOportunidade({ finalizaEm: "2027-01-10" }), { id: p.dono.id, nome: "Dono" });
    assert.ok(await prisma.feedback.findFirst({ where: { oportunidadeId: p.op.id, texto: { contains: "Prorrogou: 20/12/2026 → 10/01/2027" } } }));

    // mesmo dia com outro horário (a tela só manda o dia): não é mudança
    await prisma.oportunidade.update({ where: { id: p.op.id }, data: { finalizaEm: new Date("2027-01-10T14:03:00Z") } });
    assert.equal((await editarOportunidade(p.op.id, validarEdicaoOportunidade({ finalizaEm: "2027-01-10" }), { id: p.dono.id, nome: "Dono" }))?.mudancas.length, 0);

    // nada mudou: sem registro
    const antes = await prisma.feedback.count({ where: { oportunidadeId: p.op.id } });
    assert.equal((await editarOportunidade(p.op.id, validarEdicaoOportunidade({ nome: "Consultoria anual" }), { id: p.dono.id, nome: "Dono" }))?.mudancas.length, 0);
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: p.op.id } }), antes);

    assert.throws(() => validarEdicaoOportunidade({ probabilidade: "MUITO" }), /probabilidade inválido/);
    await assert.rejects(editarOportunidade(p.op.id, { responsavelId: "nao-existe" }, { id: p.dono.id, nome: null }), /Responsável não encontrado/);
  } finally { await p.limpar(); }
});

test("produtos recalculam os valores e travam a edição manual", async () => {
  const p = await preparar();
  try {
    const cat = await prisma.produto.create({ data: { nome: `Mentoria ${p.marca}`, valor: 3000, recorrencia: "MENSAL" } });
    const l1 = await adicionarLinha(p.op.id, await validarLinha({ produtoId: cat.id }));
    await adicionarLinha(p.op.id, await validarLinha({ nome: "Diagnóstico", valorUnitario: "8000", desconto: 25 }));
    let op = await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } });
    assert.equal(Number(op.valorMensal), 3000);
    assert.equal(Number(op.valorUnico), 6000); // o 1000 manual some: agora vem das linhas

    await editarLinha(p.op.id, l1.id, await validarLinha({ quantidade: 2 }, true));
    op = await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } });
    assert.equal(Number(op.valorMensal), 6000);

    await assert.rejects(editarOportunidade(p.op.id, { valorUnico: 1 }, { id: p.dono.id, nome: null }), /vêm dos produtos/);
    assert.equal(await editarLinha("outra", l1.id, { quantidade: 1 }), false); // linha de outra oportunidade

    const linhas = await prisma.oportunidadeProduto.findMany({ where: { oportunidadeId: p.op.id } });
    for (const l of linhas) await removerLinha(p.op.id, l.id);
    op = await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } });
    assert.equal(Number(op.valorUnico) + Number(op.valorMensal), 0);
  } finally { await p.limpar(); }
});

test("rotas: detalhe, edição, produto avulso e catálogo só para administrador", async () => {
  const p = await preparar();
  try {
    const ck = async (uid: string) => `${COOKIE_SESSAO}=${await assinarSessao(uid, process.env.SESSION_SECRET!)}`;
    const req = async (url: string, metodo: string, corpo: unknown, uid: string | null) =>
      new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(uid ? { cookie: await ck(uid) } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
    const params = { params: Promise.resolve({ id: p.op.id }) };

    assert.equal((await getOp(await req(`/api/oportunidades/${p.op.id}`, "GET", undefined, null), params)).status, 401);
    const det = await (await getOp(await req(`/api/oportunidades/${p.op.id}`, "GET", undefined, p.dono.id), params)).json();
    assert.ok(det.usuarios.some((u: { id: string }) => u.id === p.outro.id));
    assert.deepEqual(det.produtos, []);

    assert.equal((await patchOp(await req("/x", "PATCH", { probabilidade: "X" }, p.dono.id), params)).status, 400);
    assert.equal((await patchOp(await req("/x", "PATCH", { origem: "Indicação" }, p.dono.id), params)).status, 200);
    assert.equal((await patchOp(await req("/x", "PATCH", { origem: "x" }, p.dono.id), { params: Promise.resolve({ id: "nao-existe" }) })).status, 404);

    assert.equal((await postProduto(await req("/x", "POST", { nome: "Workshop", valorUnitario: 2500 }, p.outro.id), params)).status, 201);
    assert.equal(Number((await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } })).valorUnico), 2500);

    assert.equal((await postCatalogo(await req("/x", "POST", { nome: `Curso ${p.marca}`, valor: 100 }, p.outro.id))).status, 403); // vendedor
    assert.equal((await postCatalogo(await req("/x", "POST", { nome: `Curso ${p.marca}`, valor: 100 }, p.dono.id))).status, 201);
    assert.equal((await postCatalogo(await req("/x", "POST", { nome: `Curso ${p.marca}`, valor: 100 }, p.dono.id))).status, 409);
  } finally { await p.limpar(); }
});
