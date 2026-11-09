// Conversas do WhatsApp: leitura do arquivo exportado, importação (dedupe, contato e oportunidade certos,
// trecho novo para o agente), rota da extensão (chave de serviço) e leitura do DOM do WhatsApp Web.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { gerarChave } from "@/lib/integracao/chave";
import { lerArquivoWhatsapp } from "@/lib/conversas/arquivo";
import { analisarConversasOciosas, CONVERSA_OCIOSA_MS, importarConversa } from "@/lib/conversas/importar";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { POST as postConversaVI } from "@/app/api/integracoes/vendedor-ia/conversas/route";
import { POST as postImportar } from "@/app/api/conversas/importar/route";
import { GET as getConversa } from "@/app/api/oportunidades/[id]/conversa/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
test("arquivo exportado: Android, iPhone, mensagem em várias linhas, avisos e mídia de fora", () => {
  const android = [
    "07/11/2026 14:30 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.",
    "07/11/2026 14:31 - Oficina Rocha: Fechado então, me manda o BI até dia 20?",
    "07/11/2026 14:32 - Pedro: Combinado! Entrego o BI dia 20.",
    "Na semana seguinte subimos o tráfego.",
    "07/11/2026 14:33 - Oficina Rocha: <Mídia oculta>",
    "07/11/26 9:05 - Pedro: ano com dois dígitos",
  ].join("\n");
  const a = lerArquivoWhatsapp(android);
  assert.deepEqual(a.autores, ["Oficina Rocha", "Pedro"]);
  assert.deepEqual(a.mensagens.map((m) => [m.autor, m.texto]), [
    ["Oficina Rocha", "Fechado então, me manda o BI até dia 20?"],
    ["Pedro", "Combinado! Entrego o BI dia 20.\nNa semana seguinte subimos o tráfego."],
    ["Pedro", "ano com dois dígitos"],
  ]);
  assert.equal(a.mensagens[0].em, "2026-11-07T17:31:00.000Z", "horário do celular é Brasília");
  assert.equal(a.mensagens[2].em, "2026-11-07T12:05:00.000Z");

  const iphone = "﻿[07/11/2026, 14:31:12] Oficina Rocha: Bom dia\r\n[07/11/2026, 2:35:00 PM] Pedro: Bom dia!\r\n‎[07/11/2026, 14:36:00] Pedro: ‎imagem ocultada";
  const b = lerArquivoWhatsapp(iphone);
  assert.deepEqual(b.mensagens.map((m) => [m.autor, m.texto, m.em]), [["Oficina Rocha", "Bom dia", "2026-11-07T17:31:12.000Z"], ["Pedro", "Bom dia!", "2026-11-07T17:35:00.000Z"]]);
  assert.deepEqual(lerArquivoWhatsapp("texto qualquer\nsem formato").mensagens, []);
});

test("importar: acha o contato pelo telefone e a oportunidade aberta; reimportar não duplica; trecho novo vai ao agente com contexto", async () => {
  const c = await cenario();
  const tel = `5562${Math.floor(10000000 + Math.random() * 89999999)}`;
  const pessoa = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Dono ${c.marca}`, telefone: tel, empresaId: c.contato.id } });
  try {
    const ganha = await criarOportunidade({ nome: "Antiga", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: ganha.id, etapaId: c.perdida.id, origem: "MANUAL" });
    const aberta = await criarOportunidade({ nome: "Aberta", contatoId: c.contato.id, pessoaId: pessoa.id, funilId: c.funil.id });
    const msg = (min: number, deMim: boolean, texto: string) => ({ autor: deMim ? "Eu" : "Dono", deMim, texto, em: `2026-11-07T17:${String(min).padStart(2, "0")}:00.000Z` });
    const r1 = await importarConversa({ telefone: tel.slice(2), mensagens: [msg(30, false, "Me manda o BI até dia 20?"), msg(32, true, "Combinado, entrego dia 20.")], origem: "ARQUIVO" }, { agendarAgente: false });
    assert.deepEqual([r1.contato.id, r1.oportunidade?.id, r1.recebidas, r1.novas], [pessoa.id, aberta.id, 2, 2], "telefone sem DDI acha o contato; vai para a oportunidade em andamento");
    const a1 = (await prisma.analiseAgente.findUnique({ where: { id: r1.analiseId! } }))!;
    assert.equal(a1.fonte, "CONVERSA");
    assert.match(a1.texto, /Dono: Me manda o BI até dia 20\?\n.*Consultor: Combinado, entrego dia 20\./);

    const r2 = await importarConversa({ telefone: tel, mensagens: [msg(30, false, "Me manda o BI até dia 20?"), msg(32, true, "Combinado, entrego dia 20."), msg(40, false, "Perfeito, e os acessos eu mando amanhã.")], origem: "ARQUIVO" }, { agendarAgente: false });
    assert.deepEqual([r2.novas, r2.recebidas], [1, 3], "só a mensagem nova entra");
    const a2 = (await prisma.analiseAgente.findUnique({ where: { id: r2.analiseId! } }))!;
    assert.notEqual(a2.id, a1.id);
    assert.match(a2.texto, /\(mensagens anteriores, só para contexto\)[\s\S]*Combinado, entrego dia 20\.[\s\S]*\(mensagens novas\)\n.*Perfeito, e os acessos eu mando amanhã\./);
    const r3 = await importarConversa({ telefone: tel, mensagens: [msg(40, false, "Perfeito, e os acessos eu mando amanhã.")], origem: "ARQUIVO" }, { agendarAgente: false });
    assert.deepEqual([r3.novas, r3.analiseId], [0, null], "nada novo, nada para o agente");
    assert.equal(await prisma.mensagem.count({ where: { contatoId: pessoa.id } }), 3);

    // Telefone desconhecido: cria o contato; sem oportunidade, guarda a conversa e não chama o agente.
    const outro = `5511${Math.floor(10000000 + Math.random() * 89999999)}`;
    const r4 = await importarConversa({ telefone: outro, nome: `Novo ${c.marca}`, mensagens: [msg(1, false, "Oi, quero saber da consultoria")], origem: "ARQUIVO" }, { agendarAgente: false });
    assert.deepEqual([r4.contato.criado, r4.contato.nome, r4.oportunidade, r4.analiseId], [true, `Novo ${c.marca}`, null, null]);
    await assert.rejects(importarConversa({ telefone: "123", mensagens: [msg(1, false, "x")], origem: "ARQUIVO" }), /Telefone/);
    await prisma.contato.delete({ where: { id: r4.contato.id } });
  } finally {
    await c.limpar();
    await prisma.contato.deleteMany({ where: { id: pessoa.id } });
  }
});

test("rotas: Vendedor IA com chave de serviço (só lead conhecido); importação pela tela com sessão; conversa na ficha", async () => {
  const c = await cenario();
  const k = gerarChave();
  const chave = await prisma.chaveIntegracao.create({ data: { nome: "Vendedor IA", prefixo: k.prefixo, hash: k.hash } });
  const u = await prisma.usuario.create({ data: { nome: "Conv", email: `conv-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const tel = `5562${Math.floor(10000000 + Math.random() * 89999999)}`;
  const leadId = `lead-${c.marca}`;
  const pessoa = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Cli ${c.marca}`, telefone: tel, vendedorIaLeadId: leadId } });
  const req = (url: string, corpo: unknown, h: Record<string, string>) => new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(corpo) });
  const auth = { authorization: `Bearer ${k.chave}` };
  try {
    const op = await criarOportunidade({ nome: "Conv", contatoId: pessoa.id, funilId: c.funil.id });
    const mensagens = [{ id: "wamid.1", autor: "Cli", deMim: false, texto: "Pode mandar o contrato hoje?", em: "2026-11-07T17:00:00Z" }];
    assert.equal((await postConversaVI(req("/x", { leadId, mensagens }, {}))).status, 401);
    assert.equal((await postConversaVI(req("/x", { leadId, mensagens }, { authorization: "Bearer avz_live_" + "0".repeat(48) }))).status, 401);
    // lead que o CRM não conhece: nada é gravado, nem contato criado
    const antes = await prisma.contato.count();
    assert.deepEqual(await (await postConversaVI(req("/x", { leadId: "lead-desconhecido", telefone: "5511999990000", mensagens }, auth))).json(), { status: "IGNORADO" });
    assert.equal(await prisma.contato.count(), antes);
    // primeira pergunta, sem mensagens
    assert.deepEqual(await (await postConversaVI(req("/x", { leadId, mensagens: [] }, auth))).json(), { status: "CONHECIDO" });
    assert.equal((await postConversaVI(req("/x", { leadId, mensagens: "x" }, auth))).status, 400);
    const r = await (await postConversaVI(req("/x", { leadId, telefone: tel, mensagens }, auth))).json();
    assert.deepEqual([r.status, r.novas, r.oportunidadeId], ["PROCESSADO", 1, op.id]);
    const gravada = await prisma.mensagem.findFirstOrThrow({ where: { contatoId: pessoa.id } });
    assert.deepEqual([gravada.origem, gravada.analisadaEm], ["VENDEDOR_IA", null], "o agente lê depois, quando a conversa esfriar");

    assert.equal((await postImportar(req("/api/conversas/importar", { contatoId: pessoa.id, mensagens }, {}))).status, 401);
    const r2 = await postImportar(req("/api/conversas/importar", { contatoId: pessoa.id, mensagens: [...mensagens, { autor: "Eu", deMim: true, texto: "Mando sim, até as 18h.", em: "2026-11-07T17:05:00Z" }] }, { cookie }));
    assert.equal(r2.status, 201);
    assert.equal((await r2.json()).novas, 1, "a do cliente já tinha vindo pelo Vendedor IA");

    const g = await getConversa(new Request(`http://x/api/oportunidades/${op.id}/conversa`, { headers: { cookie } }), { params: Promise.resolve({ id: op.id }) });
    assert.deepEqual((await g.json()).mensagens.map((m: { deMim: boolean; texto: string }) => [m.deMim, m.texto]), [[false, "Pode mandar o contrato hoje?"], [true, "Mando sim, até as 18h."]]);
  } finally {
    await prisma.chaveIntegracao.delete({ where: { id: chave.id } });
    await prisma.usuario.delete({ where: { id: u.id } });
    await c.limpar(); // apaga as oportunidades do funil de teste antes do contato
    await prisma.contato.deleteMany({ where: { id: pessoa.id } });
  }
});

test("conversa do Vendedor IA: o agente lê o trecho quando a conversa para 30 minutos, uma vez só", async () => {
  const c = await cenario();
  const tel = `5562${Math.floor(10000000 + Math.random() * 89999999)}`;
  const pessoa = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `VI ${c.marca}`, telefone: tel } });
  try {
    const op = await criarOportunidade({ nome: "VI", contatoId: pessoa.id, funilId: c.funil.id });
    const t0 = new Date(Date.now() + 3_600_000); // depois da criação da oportunidade
    const m = (min: number, deMim: boolean, texto: string) => ({ autor: deMim ? "Vendedor IA" : "Cliente", deMim, texto, em: new Date(t0.getTime() + min * 60_000) });
    const r = await importarConversa({ contatoId: pessoa.id, mensagens: [m(0, false, "Quero fechar o diagnóstico"), m(1, true, "Ótimo! Te mando a proposta até sexta.")], origem: "VENDEDOR_IA" });
    assert.equal(r.analiseId, null, "não analisa na chegada");
    assert.equal((await prisma.oportunidade.findUniqueOrThrow({ where: { id: op.id } })).ultimaAtividadeEm.toISOString(), m(1, true, "").em.toISOString(), "atividade = hora da mensagem");

    assert.deepEqual(await analisarConversasOciosas({ agora: new Date(t0.getTime() + 10 * 60_000), agendarAgente: false }), { analises: 0 }, "ainda conversando");
    await importarConversa({ contatoId: pessoa.id, mensagens: [m(12, false, "Combinado")], origem: "VENDEDOR_IA" });
    const depois = new Date(t0.getTime() + 12 * 60_000 + CONVERSA_OCIOSA_MS);
    assert.deepEqual(await analisarConversasOciosas({ agora: depois, agendarAgente: false }), { analises: 1 });
    const a = await prisma.analiseAgente.findFirstOrThrow({ where: { oportunidadeId: op.id, fonte: "CONVERSA" } });
    assert.match(a.texto, /Cliente: Quero fechar o diagnóstico\n.*Consultor: Ótimo! Te mando a proposta até sexta\.\n.*Cliente: Combinado/);
    assert.equal(await prisma.mensagem.count({ where: { contatoId: pessoa.id, analisadaEm: null } }), 0);
    assert.deepEqual(await analisarConversasOciosas({ agora: depois, agendarAgente: false }), { analises: 0 }, "não relê");
  } finally {
    await c.limpar();
    await prisma.contato.deleteMany({ where: { id: pessoa.id } });
  }
});
