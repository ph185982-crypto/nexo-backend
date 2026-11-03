import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { gerarChave, validarChave } from "@/lib/integracao/chave";
import { normalizarTelefone, validarEvento } from "@/lib/integracao/vendedor-ia";
import { POST as postEvento } from "@/app/api/integracoes/vendedor-ia/eventos/route";

const req = (corpo: unknown, auth?: string) =>
  new Request("http://x/api/integracoes/vendedor-ia/eventos", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(corpo) });

test("chave: só a de serviço ativa vale; revogada ou inventada é recusada", async () => {
  const k = gerarChave();
  assert.match(k.chave, /^avz_live_[a-f0-9]{48}$/);
  const reg = await prisma.chaveIntegracao.create({ data: { nome: "teste", prefixo: k.prefixo, hash: k.hash } });
  try {
    const com = (t: string) => new Request("http://x", { headers: { authorization: `Bearer ${t}` } });
    assert.equal((await validarChave(com(k.chave)))?.id, reg.id);
    assert.ok((await prisma.chaveIntegracao.findUnique({ where: { id: reg.id } }))!.ultimoUsoEm);
    assert.equal(await validarChave(com("avz_live_" + "0".repeat(48))), null);
    assert.equal(await validarChave(new Request("http://x")), null);
    await prisma.chaveIntegracao.update({ where: { id: reg.id }, data: { revogadaEm: new Date() } });
    assert.equal(await validarChave(com(k.chave)), null);
  } finally { await prisma.chaveIntegracao.delete({ where: { id: reg.id } }); }
});

test("telefone e formato do evento", () => {
  assert.equal(normalizarTelefone("(62) 98446-5388"), "5562984465388");
  assert.equal(normalizarTelefone("+55 62 98446-5388"), "5562984465388");
  assert.equal(normalizarTelefone("123"), null);
  assert.equal(validarEvento({ eventoId: "abc", tipo: "lead.qualificado" }).ok, false, "eventoId curto");
  assert.equal(validarEvento({ eventoId: "evt-12345678", tipo: "Qualificado" }).ok, false, "tipo fora do padrão");
  assert.equal(validarEvento({ eventoId: "evt-12345678", tipo: "lead.qualificado", lead: {} }).ok, false, "lead sem id");
  assert.equal(validarEvento({ eventoId: "evt-12345678", tipo: "lead.qualificado", lead: { id: "L1" } }).ok, true);
});

test("evento lead.qualificado cria contato, empresa e oportunidade; reenviar não duplica", async () => {
  const c = await cenario(true); // funil padrão deste teste
  const k = gerarChave();
  const reg = await prisma.chaveIntegracao.create({ data: { nome: "teste", prefixo: k.prefixo, hash: k.hash } });
  const evId = `evt-${c.marca}`;
  const leadId = `lead-${c.marca}`;
  const evento = { eventoId: evId, tipo: "lead.qualificado", marca: c.marca, lead: { id: leadId, telefone: "62984465388", nome: `Dono ${c.marca}`, empresa: `Oficina ${c.marca}`, segmento: "Autopeças", origem: c.marca } };
  try {
    assert.equal((await postEvento(req(evento))).status, 401, "sem chave");
    assert.equal((await postEvento(req({ eventoId: "x" }, k.chave))).status, 400, "evento inválido");

    const r1 = await postEvento(req(evento, k.chave));
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.status, "PROCESSADO");

    const op = (await prisma.oportunidade.findUnique({ where: { id: j1.oportunidadeId }, include: { contato: true, pessoa: true, etapa: true } }))!;
    assert.equal(op.etapa.nome, "Qualificação", "entra na etapa de qualificação do funil padrão");
    assert.equal(op.contato.tipo, "EMPRESA");
    assert.equal(op.pessoa?.telefone, "5562984465388");
    assert.equal(op.pessoa?.empresaId, op.contato.id);
    assert.equal(op.vendedorIaLeadId, leadId);
    assert.deepEqual(op.tags, ["vendedor-ia"]);
    const h = await c.historico(op.id);
    assert.deepEqual([h.length, h[0].origem, h[0].ator], [1, "INTEGRACAO", "vendedor-ia"]);

    const r2 = await (await postEvento(req(evento, k.chave))).json();
    assert.equal(r2.status, "DUPLICADO", "mesmo eventoId");
    // outro evento para o mesmo lead, com oportunidade ainda aberta: não cria segunda
    const r3 = await (await postEvento(req({ ...evento, eventoId: evId + "-b" }, k.chave))).json();
    assert.equal(r3.status, "IGNORADO");
    assert.equal(await prisma.oportunidade.count({ where: { vendedorIaLeadId: leadId } }), 1);
    assert.equal(await prisma.contato.count({ where: { telefone: "5562984465388", nome: { contains: c.marca } } }), 1, "contato reaproveitado");

    // tipo ainda não tratado: registrado e ignorado, sem erro
    const r4 = await (await postEvento(req({ eventoId: evId + "-c", tipo: "lead.escalado", marca: c.marca, lead: { id: leadId } }, k.chave))).json();
    assert.equal(r4.status, "IGNORADO");
    assert.equal(await prisma.eventoIntegracao.count({ where: { eventoId: { startsWith: evId } } }), 3);
  } finally {
    await prisma.eventoIntegracao.deleteMany({ where: { eventoId: { startsWith: evId } } });
    await prisma.chaveIntegracao.delete({ where: { id: reg.id } });
    await prisma.contato.deleteMany({ where: { OR: [{ nome: { contains: c.marca } }, { origem: c.marca }] } }).catch(() => {});
    await c.limpar();
  }
});
