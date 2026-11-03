import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { gerarChave, validarChave } from "@/lib/integracao/chave";
import { normalizarTelefone, validarEvento } from "@/lib/integracao/vendedor-ia";
import { POST as postEvento } from "@/app/api/integracoes/vendedor-ia/eventos/route";

const DIA = 86_400_000;
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
    const r4 = await (await postEvento(req({ eventoId: evId + "-c", tipo: "lead.dormindo", marca: c.marca, lead: { id: leadId } }, k.chave))).json();
    assert.equal(r4.status, "IGNORADO");
    assert.equal(await prisma.eventoIntegracao.count({ where: { eventoId: { startsWith: evId } } }), 3);
  } finally {
    await prisma.eventoIntegracao.deleteMany({ where: { eventoId: { startsWith: evId } } });
    await prisma.chaveIntegracao.delete({ where: { id: reg.id } });
    await prisma.contato.deleteMany({ where: { OR: [{ nome: { contains: c.marca } }, { origem: c.marca }] } }).catch(() => {});
    await c.limpar();
  }
});

test("eventos escalado, reunião, intenção, perdido e ganho: efeito no CRM e idempotência", async () => {
  const { processarEventoVendedorIa } = await import("@/lib/integracao/vendedor-ia");
  const { calcularSaude } = await import("@/lib/atividades/feedback");
  const c = await cenario(true);
  const ev = (n: string, extra: Record<string, unknown>, leadId: string) => processarEventoVendedorIa({ eventoId: `${n}:${c.marca}:${leadId}`, lead: { id: `${leadId}-${c.marca}`, telefone: "62984465388", nome: `Dono ${c.marca}`, empresa: `Oficina ${c.marca}` }, ...extra } as never);
  try {
    // escalado sem oportunidade prévia: abre uma e cria a tarefa de assumir a conversa
    const e1 = await ev("a", { tipo: "lead.escalado" }, "L1");
    assert.equal(e1.status, "PROCESSADO");
    const op1 = (await prisma.oportunidade.findUnique({ where: { id: e1.oportunidadeId! }, include: { tarefas: true, feedbacks: true } }))!;
    assert.deepEqual(op1.tarefas.map((t) => [t.titulo.startsWith("Assumir a conversa"), t.prioridade, t.origem, t.status]), [[true, "ALTA", "INTEGRACAO", "ABERTA"]]);
    assert.equal(op1.feedbacks[0].tipo, "SISTEMA");
    assert.equal((await ev("b", { tipo: "lead.escalado" }, "L1")).status, "IGNORADO", "segunda escalada não duplica a tarefa");
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op1.id } }), 1);

    // intenção vira feedback do WhatsApp com o sinal; saúde sobe; unknown/ausente é recusada ou ignorada
    const e2 = await ev("c", { tipo: "intencao.detectada", intencao: "SINAL_FECHAMENTO", texto: "pode mandar o contrato" }, "L1");
    assert.equal(e2.status, "PROCESSADO");
    const fb = await prisma.feedback.findMany({ where: { oportunidadeId: op1.id, tipo: "WHATSAPP" } });
    assert.deepEqual([fb.length, fb[0].intencao, fb[0].texto, fb[0].autor], [1, "SINAL_FECHAMENTO", "pode mandar o contrato", "vendedor-ia"]);
    assert.equal(calcularSaude(fb.map((f) => f.intencao), 0).rotulo, "QUENTE");
    assert.equal(validarEvento({ eventoId: "evt-12345678", tipo: "intencao.detectada", intencao: "INVENTADA", lead: { id: "x" } }).ok, false);
    assert.equal((await ev("d", { tipo: "intencao.detectada" }, "L1")).status, "IGNORADO", "sem intenção");
    assert.equal((await ev("e", { tipo: "intencao.detectada", intencao: "OBJECAO_PRECO" }, "SEM-OP")).status, "IGNORADO", "lead sem oportunidade aberta");

    // reunião: compromisso de ligação no horário; reenvio do mesmo horário não duplica
    const quando = new Date(Date.now() + 2 * DIA).toISOString();
    assert.equal((await ev("f", { tipo: "reuniao.agendada", reuniaoEm: quando }, "L1")).status, "PROCESSADO");
    const comp = await prisma.compromisso.findMany({ where: { oportunidadeId: op1.id } });
    assert.deepEqual([comp.length, comp[0].tipo, comp[0].origem, comp[0].inicio.toISOString(), comp[0].fim.getTime() - comp[0].inicio.getTime()], [1, "LIGACAO", "INTEGRACAO", quando, 1_800_000]);
    assert.equal((await ev("g", { tipo: "reuniao.agendada", reuniaoEm: quando }, "L1")).status, "IGNORADO");
    assert.equal((await ev("h", { tipo: "reuniao.agendada" }, "L1")).status, "IGNORADO", "sem horário");
    assert.equal(validarEvento({ eventoId: "evt-12345678", tipo: "reuniao.agendada", reuniaoEm: "amanhã", lead: { id: "x" } }).ok, false);

    // perdido com motivo do catálogo; sem oportunidade aberta depois, ignora
    assert.equal((await ev("i", { tipo: "lead.perdido", motivo: "Sem interesse" }, "L1")).status, "PROCESSADO");
    const perdida = (await prisma.oportunidade.findUnique({ where: { id: op1.id }, include: { motivo: true, etapa: true } }))!;
    assert.deepEqual([perdida.status, perdida.etapa.nome, perdida.motivo?.nome], ["PERDIDA", "Perdida", "Sem interesse"]);
    assert.equal((await c.historico(op1.id)).at(-1)!.origem, "INTEGRACAO");
    assert.equal((await ev("j", { tipo: "lead.perdido", motivo: "Preço" }, "L1")).status, "IGNORADO");

    // ganho de um lead novo (nasce aberta via qualificado e fecha)
    assert.equal((await ev("k", { tipo: "lead.qualificado" }, "L2")).status, "PROCESSADO");
    assert.equal((await ev("l", { tipo: "lead.ganho" }, "L2")).status, "PROCESSADO");
    assert.equal((await prisma.oportunidade.findFirst({ where: { vendedorIaLeadId: `L2-${c.marca}` } }))!.status, "GANHA");

    // sem lead / tipo desconhecido: registrado e ignorado
    assert.equal((await processarEventoVendedorIa({ eventoId: `m:${c.marca}`, tipo: "lead.escalado" })).status, "IGNORADO");
    assert.equal((await ev("n", { tipo: "lead.dormindo" }, "L1")).status, "IGNORADO");
  } finally {
    await prisma.eventoIntegracao.deleteMany({ where: { eventoId: { contains: c.marca } } });
    await c.limpar();
  }
});
