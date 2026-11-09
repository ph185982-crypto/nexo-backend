// Filtros do kanban, CSV, busca global e avisos do sino.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { montarQuadro } from "@/lib/funil/quadro";
import { csvOportunidades, filtrarQuadro, opcoesDoQuadro, SEM_FILTRO } from "@/lib/funil/filtro";
import { avisosDoUsuario, buscar } from "@/lib/navegacao";

const DIA = 86_400_000;

async function preparar() {
  const c = await cenario();
  const dono = await prisma.usuario.create({ data: { nome: `Ana ${c.marca}`, email: `nav-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4), papel: "VENDEDOR" } });
  const agora = new Date();
  const quente = await criarOportunidade({ nome: `Projeto Álpha ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id, responsavelId: dono.id, probabilidade: "QUENTE", tags: ["vip"], valorUnico: 5000, finalizaEm: new Date(agora.getTime() - 2 * DIA) });
  const parada = await criarOportunidade({ nome: `Mentoria ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id, valorMensal: 900 });
  await prisma.oportunidade.update({ where: { id: parada.id }, data: { ultimaAtividadeEm: new Date(agora.getTime() - 20 * DIA) } });
  await prisma.tarefa.create({ data: { titulo: `Ligar ${c.marca}`, prazoEm: new Date(agora.getTime() - DIA), responsavelId: dono.id, oportunidadeId: quente.id } });
  const limpar = async () => { await prisma.tarefa.deleteMany({ where: { responsavelId: dono.id } }); await c.limpar(); await prisma.usuario.delete({ where: { id: dono.id } }); };
  return { ...c, dono, quente, parada, limpar };
}

test("filtros do quadro: texto sem acento, responsável, tag e situação", async () => {
  const p = await preparar();
  try {
    const q = (await montarQuadro(p.funil.id))!;
    const n = (f: Partial<typeof SEM_FILTRO>) => filtrarQuadro(q, { ...SEM_FILTRO, ...f }).etapas.reduce((s, e) => s + e.quantidade, 0);
    assert.equal(n({}), 2);
    assert.equal(n({ q: "projeto alpha" }), 1);
    assert.equal(n({ responsavel: p.dono.nome }), 1);
    assert.equal(n({ responsavel: "—" }), 1);
    assert.equal(n({ tag: "vip" }), 1);
    assert.equal(n({ probabilidade: "QUENTE" }), 1);
    assert.equal(n({ situacao: "ATRASADA" }), 1);
    assert.equal(n({ situacao: "PARADA" }), 1);
    assert.equal(n({ situacao: "SEM_PROXIMA" }), 1); // a "parada" não tem tarefa
    assert.equal(filtrarQuadro(q, { ...SEM_FILTRO, tag: "vip" }).etapas[0].total, 5000);
    assert.deepEqual(opcoesDoQuadro(q).tags, ["vip"]);

    const csv = csvOportunidades(q);
    assert.ok(csv.startsWith("﻿Código;Oportunidade;"));
    assert.match(csv, /Projeto Álpha .*;5000,00;0,00;5000,00;Quente;/);
  } finally { await p.limpar(); }
});

test("CSV neutraliza fórmula", async () => {
  const p = await preparar();
  try {
    await prisma.oportunidade.update({ where: { id: p.parada.id }, data: { nome: "=HYPERLINK(\"x\")" } });
    const csv = csvOportunidades((await montarQuadro(p.funil.id))!);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  } finally { await p.limpar(); }
});

test("busca global acha oportunidade por nome e código, e contato", async () => {
  const p = await preparar();
  try {
    const porNome = await buscar(`alpha ${p.marca}`.replace("alpha", "Álpha"));
    assert.ok(porNome.some((r) => r.tipo === "OPORTUNIDADE" && r.id === p.quente.id && r.href.includes(`abrir=${p.quente.id}`)));
    const op = await prisma.oportunidade.findUniqueOrThrow({ where: { id: p.quente.id } });
    assert.ok((await buscar(String(op.numero))).some((r) => r.id === p.quente.id));
    assert.ok((await buscar(`Empresa ${p.marca}`)).some((r) => r.tipo === "CONTATO" && r.id === p.contato.id));
    assert.deepEqual(await buscar("a"), []);
  } finally { await p.limpar(); }
});

test("avisos: tarefa atrasada e oportunidade atrasada do usuário; vendedor não vê o que é sem dono", async () => {
  const p = await preparar();
  try {
    const avisos = await avisosDoUsuario(p.dono.id);
    assert.ok(avisos.some((a) => a.chave.startsWith("t:") && a.nivel === "CRITICO"));
    assert.ok(avisos.some((a) => a.chave === `a:${p.quente.id}`));
    assert.ok(!avisos.some((a) => a.chave === `p:${p.parada.id}`)); // sem dono: vai para o administrador
  } finally { await p.limpar(); }
});
