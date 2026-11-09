// Propostas: criação a partir dos produtos, versões, envio, link público, aceite e recusa.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { adicionarLinha } from "@/lib/oportunidades/produtos";
import { criarProposta, editarProposta, enviarProposta, preencher, propostaPublica, responderProposta, validarEdicaoProposta } from "@/lib/propostas/servico";
import { avisosDoUsuario } from "@/lib/navegacao";
import { POST as postResposta } from "@/app/api/publico/propostas/[token]/route";
import { POST as postVisita } from "@/app/api/publico/propostas/[token]/visita/route";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";

async function preparar() {
  const c = await cenario();
  const dono = await prisma.usuario.create({ data: { nome: `Pedro ${c.marca}`, email: `prop-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4), papel: "VENDEDOR" } });
  const pessoa = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Marta Lima ${c.marca}`, empresaId: c.contato.id, telefone: "5562988110099" } });
  const op = await criarOportunidade({ nome: "Plano de crescimento", contatoId: c.contato.id, pessoaId: pessoa.id, funilId: c.funil.id, responsavelId: dono.id });
  const limpar = async () => { await c.limpar(); await prisma.contato.deleteMany({ where: { id: pessoa.id } }); await prisma.usuario.delete({ where: { id: dono.id } }); };
  return { ...c, dono, pessoa, op, autor: { id: dono.id, nome: dono.nome }, limpar };
}

test("preencher troca só as chaves conhecidas", () => {
  assert.equal(preencher("Olá, {contato}! {cliente} / {x}", { cliente: "Padaria", contato: "Marta", oportunidade: "P", consultor: "Pedro" }), "Olá, Marta! Padaria / {x}");
});

test("cria dos produtos, versão nova substitui a anterior e mantém os textos ajustados; sem valor não cria", async () => {
  const p = await preparar();
  try {
    await assert.rejects(criarProposta(p.op.id, p.autor), /Adicione produtos/);
    await adicionarLinha(p.op.id, { nome: "Diagnóstico", quantidade: 1, valorUnitario: 9000, desconto: 10, recorrencia: "UNICO" });
    await adicionarLinha(p.op.id, { nome: "Consultoria mensal", quantidade: 1, valorUnitario: 4500, desconto: 0, recorrencia: "MENSAL" });
    const v1 = (await criarProposta(p.op.id, p.autor))!;
    assert.deepEqual([v1.versao, v1.status, Number(v1.valorUnico), Number(v1.valorMensal)], [1, "RASCUNHO", 8100, 4500]);
    assert.match(v1.introducao, /Olá, Marta!/);
    assert.ok(v1.validaAte && v1.validaAte > new Date());
    assert.equal(await propostaPublica(v1.token), null, "rascunho não tem link");

    await editarProposta(v1.id, validarEdicaoProposta({ titulo: "Plano Pão Dourado", condicoes: "À vista com 5%." }));
    await enviarProposta(v1.id, p.autor);
    await assert.rejects(editarProposta(v1.id, { titulo: "x" }), /Só o rascunho/);
    await assert.rejects(enviarProposta(v1.id, p.autor), /já foi enviada/);

    const v2 = (await criarProposta(p.op.id, p.autor))!;
    assert.deepEqual([v2.versao, v2.titulo, v2.condicoes], [2, "Plano Pão Dourado", "À vista com 5%."]);
    assert.equal((await prisma.proposta.findUniqueOrThrow({ where: { id: v1.id } })).status, "OBSOLETA");
    const r = await responderProposta(v1.token, { aceitar: true, nome: "Marta", comentario: null });
    assert.deepEqual(r, { ok: false, erro: "Esta versão foi substituída por uma mais nova. Peça o link atualizado.", status: 409 });
  } finally { await p.limpar(); }
});

test("link público: visita registrada uma vez, aceite vira sinal de fechamento e aviso; não responde duas vezes nem vencida", async () => {
  const p = await preparar();
  try {
    await prisma.oportunidade.update({ where: { id: p.op.id }, data: { valorUnico: 5000 } });
    const prop = (await criarProposta(p.op.id, p.autor))!;
    await enviarProposta(prop.id, p.autor);
    const ctx = { params: Promise.resolve({ token: prop.token }) };
    const req = (corpo?: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

    assert.equal((await postVisita(req(), ctx)).status, 204);
    assert.equal((await postVisita(req(), ctx)).status, 204);
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: p.op.id, texto: { startsWith: "O cliente abriu" } } }), 1);
    assert.equal((await postVisita(req(), { params: Promise.resolve({ token: "x".repeat(32) }) })).status, 404);

    assert.equal((await postResposta(req({ aceitar: true, nome: "" }), ctx)).status, 400);
    const r = await postResposta(req({ aceitar: true, nome: "Marta Lima", comentario: "Podemos começar segunda." }), ctx);
    assert.deepEqual(await r.json(), { status: "ACEITA" });
    assert.equal((await postResposta(req({ aceitar: false, nome: "Outro" }), ctx)).status, 409, "não responde de novo");

    const f = await prisma.feedback.findFirstOrThrow({ where: { oportunidadeId: p.op.id, intencao: "SINAL_FECHAMENTO" } });
    assert.match(f.texto, /Marta Lima ACEITOU a proposta .*\n"Podemos começar segunda\."/);
    assert.equal((await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.op.id } })).probabilidade, "QUENTE");
    assert.ok((await avisosDoUsuario(p.dono.id)).some((a) => a.chave === `pr:${prop.id}` && /aceitou/.test(a.detalhe)));

    // vencida
    const outra = (await criarProposta(p.op.id, p.autor))!;
    await enviarProposta(outra.id, p.autor);
    await prisma.proposta.update({ where: { id: outra.id }, data: { validaAte: new Date(Date.now() - 1000) } });
    assert.match(((await responderProposta(outra.token, { aceitar: true, nome: "Marta", comentario: null })) as { erro: string }).erro, /validade/);
  } finally { await p.limpar(); }
});

test("rotas públicas da proposta passam sem login; o resto continua fechado", async () => {
  const r = (url: string) => middleware(new NextRequest(`http://x${url}`));
  assert.equal((await r("/p/abc")).status, 200);
  assert.equal((await r("/api/publico/propostas/abc")).status, 200);
  assert.equal((await r("/api/propostas/abc")).status, 401);
  assert.equal((await r("/oportunidades")).status, 307);
});
