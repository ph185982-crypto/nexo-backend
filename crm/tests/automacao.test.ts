import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { validarAcao, validarAutomacao, normalizarTag } from "@/lib/automacao/modelo";
import { avaliarCriterios, type ContextoOportunidade } from "@/lib/automacao/criterios";
import { ipPrivado, verificarUrlWebhook } from "@/lib/automacao/url-segura";
import { dispararEvento, processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getLista, POST as postAuto } from "@/app/api/automacoes/route";
import { PATCH as patchAuto, DELETE as delAuto } from "@/app/api/automacoes/[id]/route";
import { GET as getExec } from "@/app/api/automacoes/[id]/execucoes/route";
import { POST as postVarrer } from "@/app/api/automacoes/varrer/route";
import { GET as getCron } from "@/app/api/cron/automacoes/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const H = 3_600_000, DIA = 24 * H;

test("ipPrivado e verificarUrlWebhook bloqueiam rede interna", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nao-e-ip"]) assert.equal(ipPrivado(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1", "203.0.113.10", "2606:4700:4700::1111"]) assert.equal(ipPrivado(ip), false, ip);
  for (const url of ["http://203.0.113.10/x", "https://localhost/x", "https://api.localhost/x", "https://servico.internal/x", "https://impressora.local/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://10.0.0.5/x"]) await assert.rejects(verificarUrlWebhook(url), /./, url);
  await verificarUrlWebhook("https://203.0.113.10/hook"); // IP público literal passa sem DNS
});

test("validação: gatilho, ações, critérios, limites e regras dos gatilhos de tempo", () => {
  const base = { nome: "A", gatilho: "OPORTUNIDADE_MOVIDA", criterios: [], acoes: [{ tipo: "REGISTRAR_ALERTA", mensagem: "oi" }] };
  const ok = validarAutomacao(base);
  assert.deepEqual([ok.nome, ok.ativo, ok.acoes[0]], ["A", true, { tipo: "REGISTRAR_ALERTA", mensagem: "oi", esperaHoras: 0 }]);
  const erro = (corpo: unknown, re: RegExp) => assert.throws(() => validarAutomacao(corpo), re);
  erro({ ...base, gatilho: "QUANDO_QUISER" }, /gatilho inválido/);
  erro({ ...base, nome: " " }, /Nome obrigatório/);
  erro({ ...base, acoes: [] }, /ao menos uma ação/);
  erro({ ...base, acoes: Array(11).fill(base.acoes[0]) }, /No máximo 10 ações/);
  erro({ ...base, criterios: Array(11).fill({ campo: "origem", operador: "=", valor: "x" }) }, /No máximo 10 critérios/);
  erro({ ...base, acoes: [{ tipo: "APAGAR_TUDO" }] }, /tipo da ação inválido/);
  erro({ ...base, criterios: [{ campo: "origem", operador: ">=", valor: "x" }] }, /operador do critério inválido/);
  erro({ ...base, criterios: [{ campo: "diasNaEtapa", operador: ">=", valor: "muitos" }] }, /deve ser um número/);
  erro({ ...base, criterios: [{ campo: "diasNaEtapa", operador: ">=", valor: -1 }] }, /deve ser um número/);
  erro({ ...base, gatilho: "OPORTUNIDADE_ESTAGNADA" }, /exige o critério "Dias na etapa"/);
  erro({ ...base, gatilho: "OPORTUNIDADE_ESTAGNADA", criterios: [{ campo: "diasNaEtapa", operador: "<=", valor: 3 }] }, /exige o critério/);
  erro({ ...base, gatilho: "OPORTUNIDADE_SEM_INTERACAO", criterios: [{ campo: "diasNaEtapa", operador: ">=", valor: 3 }] }, /exige o critério "Dias sem atividade"/);
  assert.equal(validarAutomacao({ ...base, gatilho: "OPORTUNIDADE_SEM_INTERACAO", criterios: [{ campo: "diasSemAtividade", operador: ">=", valor: "7" }] }).criterios[0].valor, 7, "número em texto é convertido");
  // ações
  assert.deepEqual(validarAcao({ tipo: "CRIAR_TAREFA", titulo: "Ligar" }), { tipo: "CRIAR_TAREFA", titulo: "Ligar", prazoHoras: 24, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 0 });
  assert.throws(() => validarAcao({ tipo: "CRIAR_TAREFA", titulo: "x", esperaHoras: 9000 }), /Espera/);
  assert.throws(() => validarAcao({ tipo: "CRIAR_TAREFA", titulo: "x", esperaHoras: 1.5 }), /Espera/);
  assert.throws(() => validarAcao({ tipo: "CRIAR_TAREFA", titulo: "x", prioridade: "URGENTE" }), /prioridade inválido/);
  assert.throws(() => validarAcao({ tipo: "DISPARAR_WEBHOOK", url: "http://x.com/h" }), /https/);
  assert.throws(() => validarAcao({ tipo: "DISPARAR_WEBHOOK", url: "https://user:senha@x.com/h" }), /usuário e senha/);
  assert.throws(() => validarAcao({ tipo: "DISPARAR_WEBHOOK", url: "isso não é url" }), /inválido/);
  assert.equal((validarAcao({ tipo: "DISPARAR_WEBHOOK", url: "https://x.com/h?a=1" }) as { url: string }).url, "https://x.com/h?a=1");
  assert.equal(normalizarTag("  Proposta ENVIADA! Ação "), "proposta-enviada-acao");
  assert.throws(() => validarAcao({ tipo: "ADICIONAR_TAG", tag: "!!!" }), /Tag inválida/);
});

test("critérios: cada campo e operador; tag; sem responsável; lista vazia vale", () => {
  const ctx: ContextoOportunidade = { etapaId: "e1", funilId: "f1", probabilidade: "MORNA", origem: "Anúncio", valorTotal: 5000, tags: ["a", "b"], diasNaEtapa: 4, diasSemAtividade: 9, semResponsavel: false };
  const v = (campo: string, operador: string, valor: unknown) => avaliarCriterios([{ campo, operador, valor } as never], ctx);
  assert.equal(avaliarCriterios([], ctx), true);
  assert.deepEqual([v("etapaId", "=", "e1"), v("etapaId", "!=", "e1"), v("funilId", "=", "f2"), v("probabilidade", "=", "MORNA"), v("origem", "!=", "Manual")], [true, false, false, true, true]);
  assert.deepEqual([v("valorTotal", ">=", 5000), v("valorTotal", ">=", 5001), v("valorTotal", "<=", 5000), v("valorTotal", "=", 5000)], [true, false, true, true]);
  assert.deepEqual([v("diasNaEtapa", ">=", 3), v("diasNaEtapa", ">=", 5), v("diasSemAtividade", "<=", 9), v("diasSemAtividade", "<=", 8)], [true, false, true, false]);
  assert.deepEqual([v("tag", "=", "a"), v("tag", "=", "z"), v("tag", "!=", "z"), v("tag", "!=", "a")], [true, false, true, false]);
  assert.deepEqual([v("semResponsavel", "=", false), v("semResponsavel", "=", true)], [true, false]);
  assert.equal(avaliarCriterios([{ campo: "diasNaEtapa", operador: ">=", valor: 3 }, { campo: "origem", operador: "=", valor: "Manual" }], ctx), false, "E: todos precisam valer");
});

test("motor: evento dispara, é idempotente e respeita gatilho e critérios", async () => {
  const c = await cenario();
  const criadas: string[] = [];
  try {
    const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.automacao.create({ data: { nome: `t:${c.funil.id}:${gatilho}`, gatilho, criterios, acoes } as never }); criadas.push(a.id); return a; };
    const tarefa = (titulo: string) => [{ tipo: "CRIAR_TAREFA", titulo, prazoHoras: 2, prioridade: "ALTA", tipoTarefa: "LIGACAO", esperaHoras: 0 }];
    const aCriada = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("boas-vindas"));
    const aQualif = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.qualif.id }], tarefa("qualificou"));
    const aGanha = await mk("OPORTUNIDADE_GANHA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("cobrar 1º pagamento"));
    const aPerdida = await mk("OPORTUNIDADE_PERDIDA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "perdemos", esperaHoras: 0 }]);
    const aInativa = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("nunca"));
    await prisma.automacao.update({ where: { id: aInativa.id }, data: { ativo: false } });
    const titulos = async (opId: string) => (await prisma.tarefa.findMany({ where: { oportunidadeId: opId }, orderBy: { criadoEm: "asc" } })).map((t) => t.titulo);

    const op = await criarOportunidade({ nome: "M1", contatoId: c.contato.id, funilId: c.funil.id, responsavelId: null });
    assert.deepEqual(await titulos(op.id), ["boas-vindas"], "criada dispara só a de criação");
    const t = (await prisma.tarefa.findFirst({ where: { oportunidadeId: op.id } }))!;
    assert.deepEqual([t.prioridade, t.tipo, t.origem, t.status], ["ALTA", "LIGACAO", "AUTOMACAO", "ABERTA"]);
    assert.ok(Math.abs((t.prazoEm!.getTime() - Date.now()) - 2 * H) < 60_000, "prazo = agora + 2h");

    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" });
    assert.deepEqual(await titulos(op.id), ["boas-vindas", "qualificou"], "critério de etapa; inativa nunca roda");
    await dispararEvento("OPORTUNIDADE_MOVIDA", op.id);
    await dispararEvento("OPORTUNIDADE_MOVIDA", op.id);
    assert.equal((await titulos(op.id)).length, 2, "mesmo fato não roda duas vezes");
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.equal((await titulos(op.id)).length, 2, "outra etapa não casa o critério");
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" });
    assert.equal((await titulos(op.id)).length, 3, "voltar à etapa é um fato novo");

    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    assert.ok((await titulos(op.id)).includes("cobrar 1º pagamento"));
    const p = await criarOportunidade({ nome: "M2", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: p.id, etapaId: c.perdida.id, origem: "MANUAL" });
    assert.ok(!(await titulos(p.id)).includes("cobrar 1º pagamento"), "perdida não dispara a de ganha");
    const alerta = await prisma.feedback.findFirst({ where: { oportunidadeId: p.id, autor: "automacao" } });
    assert.deepEqual([alerta?.texto, alerta?.importante, alerta?.tipo, alerta?.autorNome], ["perdemos", true, "SISTEMA", aPerdida.nome]);
    const ex = await prisma.automacaoExecucao.findMany({ where: { automacaoId: aCriada.id } });
    assert.deepEqual([ex.length >= 2, ex.every((e) => e.status === "EXECUTADA" && e.detalhe?.startsWith("Tarefa criada"))], [true, true]);
    assert.equal(aQualif.id !== aGanha.id, true);
  } finally { await prisma.automacao.deleteMany({ where: { id: { in: criadas } } }); await c.limpar(); }
});

test("motor: espera reconfere critérios; ação de automação não encadeia; tag e alerta idempotentes", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.automacao.create({ data: { nome: `t:${c.funil.id}`, gatilho, criterios, acoes } as never }); ids.push(a.id); return a; };
  try {
    // 1) espera: executa só se ainda estiver na etapa
    const aEspera = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.qualif.id }], [{ tipo: "CRIAR_TAREFA", titulo: "cobrar retorno", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 48 }]);
    const ficou = await criarOportunidade({ nome: "Ficou", contatoId: c.contato.id, funilId: c.funil.id });
    const saiu = await criarOportunidade({ nome: "Saiu", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: ficou.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: saiu.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: saiu.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: { in: [ficou.id, saiu.id] } } }), 0, "espera: nada ainda");
    const pend = await prisma.automacaoExecucao.findMany({ where: { automacaoId: aEspera.id } });
    assert.deepEqual([pend.length, pend.every((e) => e.status === "PENDENTE" && e.executarEm.getTime() > Date.now() + 47 * H)], [2, true]);
    assert.deepEqual(await processarVencidas(new Date(Date.now() + 10 * H)), { executadas: 0, ignoradas: 0, erros: 0 }, "antes do prazo nada roda");
    const r = await processarVencidas(new Date(Date.now() + 49 * H));
    assert.deepEqual([r.executadas, r.ignoradas], [1, 1]);
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: ficou.id } }), 1);
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: saiu.id } }), 0);
    assert.match((await prisma.automacaoExecucao.findFirst({ where: { oportunidadeId: saiu.id } }))!.detalhe!, /critérios não valiam mais/);

    // 2) sem laço: A move para Proposta; B (movida p/ Proposta) NÃO roda por causa do movimento de A
    await prisma.automacao.deleteMany({ where: { id: aEspera.id } });
    await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.leads.id }], [{ tipo: "MOVER_ETAPA", etapaId: c.proposta.id, esperaHoras: 0 }]);
    await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.proposta.id }], [{ tipo: "CRIAR_TAREFA", titulo: "encadeada", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 0 }]);
    const op = await criarOportunidade({ nome: "Cadeia", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" }); // sai de Leads: nenhuma casa
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.leads.id, origem: "MANUAL" }); // volta a Leads: A move p/ Proposta
    const dep = (await prisma.oportunidade.findUnique({ where: { id: op.id }, include: { etapa: true } }))!;
    assert.equal(dep.etapa.nome, "Proposta e negociação", "A moveu");
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op.id, titulo: "encadeada" } }), 0, "B não disparou a partir da ação de A");
    const h = await c.historico(op.id);
    assert.deepEqual([h.at(-1)!.origem, h.at(-1)!.ator, h.at(-1)!.motivo?.startsWith("Automação:")], ["AUTOMACAO", "automacao", true]);
    // mas um movimento humano para Proposta dispara B normalmente
    const op2 = await criarOportunidade({ nome: "Humano", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op2.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op2.id, titulo: "encadeada" } }), 1);

    // 3) tag idempotente e alerta
    const aTag = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "ADICIONAR_TAG", tag: "novo-lead", esperaHoras: 0 }, { tipo: "ADICIONAR_TAG", tag: "novo-lead", esperaHoras: 0 }]);
    const t = await criarOportunidade({ nome: "Tag", contatoId: c.contato.id, funilId: c.funil.id, tags: ["x"] });
    assert.deepEqual((await prisma.oportunidade.findUnique({ where: { id: t.id } }))!.tags, ["x", "novo-lead"]);
    const det = (await prisma.automacaoExecucao.findMany({ where: { automacaoId: aTag.id }, orderBy: { indice: "asc" } })).map((e) => e.detalhe);
    assert.deepEqual(det, ["Tag #novo-lead adicionada", "Tag já existia"]);
  } finally { await prisma.automacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

test("motor: varredura de tempo (parada na etapa, sem interação), uma vez por fato; concorrência; recuperação", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.automacao.create({ data: { nome: `t:${c.funil.id}`, gatilho, criterios, acoes } as never }); ids.push(a.id); return a; };
  try {
    const parada = await mk("OPORTUNIDADE_ESTAGNADA", [{ campo: "diasNaEtapa", operador: ">=", valor: 3 }, { campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "CRIAR_TAREFA", titulo: "destravar", prazoHoras: 4, prioridade: "ALTA", tipoTarefa: "LIGACAO", esperaHoras: 0 }]);
    const muda = await mk("OPORTUNIDADE_SEM_INTERACAO", [{ campo: "diasSemAtividade", operador: ">=", valor: 7 }, { campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "cliente sumiu", esperaHoras: 0 }]);
    const velha = await criarOportunidade({ nome: "Velha", contatoId: c.contato.id, funilId: c.funil.id });
    const nova_ = await criarOportunidade({ nome: "Nova", contatoId: c.contato.id, funilId: c.funil.id });
    const ganha = await criarOportunidade({ nome: "Ganha antiga", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: ganha.id, etapaId: c.ganha.id, origem: "MANUAL" });
    await prisma.oportunidade.updateMany({ where: { id: { in: [velha.id, ganha.id] } }, data: { etapaDesdeEm: new Date(Date.now() - 5 * DIA), ultimaAtividadeEm: new Date(Date.now() - 10 * DIA) } });

    const v1 = await varrerTempo();
    assert.equal(v1.agendadas >= 2, true);
    await processarVencidas();
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 1, "velha: tarefa");
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: velha.id, texto: "cliente sumiu" } }), 1, "velha: alerta");
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: nova_.id } }), 0, "nova não casa");
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: ganha.id } }), 0, "ganha não é varrida (só em andamento)");

    await varrerTempo(); await varrerTempo(); await processarVencidas();
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 1, "uma vez por permanência na etapa");
    // sai da etapa e volta a ficar parada: fato novo
    await moverOportunidade({ oportunidadeId: velha.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await prisma.oportunidade.update({ where: { id: velha.id }, data: { etapaDesdeEm: new Date(Date.now() - 4 * DIA) } });
    await varrerTempo(); await processarVencidas();
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 2);

    // desativada: nada agenda
    await prisma.automacao.update({ where: { id: parada.id }, data: { ativo: false } });
    await prisma.oportunidade.update({ where: { id: velha.id }, data: { etapaDesdeEm: new Date(Date.now() - 9 * DIA) } });
    assert.deepEqual(await varrerTempo(), { avaliadas: (await prisma.oportunidade.count({ where: { status: "EM_ANDAMENTO" } })), agendadas: 0 });
    assert.equal(muda.id !== parada.id, true);

    // concorrência: duas rodadas simultâneas, uma execução só
    const k = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "CRIAR_TAREFA", titulo: "uma só", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 1 }]);
    const op = await criarOportunidade({ nome: "Conc", contatoId: c.contato.id, funilId: c.funil.id });
    const quando = new Date(Date.now() + 2 * H);
    await Promise.all([processarVencidas(quando), processarVencidas(quando), processarVencidas(quando)]);
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op.id, titulo: "uma só" } }), 1);

    // recuperação: linha reivindicada há muito tempo e nunca concluída volta à fila
    const travada = await prisma.automacaoExecucao.create({ data: { automacaoId: k.id, oportunidadeId: op.id, gatilho: "OPORTUNIDADE_CRIADA", indice: 0, acaoTipo: "CRIAR_TAREFA", chave: `travada:${c.marca}`, status: "EXECUTANDO", executarEm: new Date(Date.now() - 30 * 60_000) } });
    await processarVencidas();
    assert.notEqual((await prisma.automacaoExecucao.findUnique({ where: { id: travada.id } }))!.status, "EXECUTANDO");
  } finally { await prisma.automacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

test("ações com erro viram ERRO sem derrubar as demais; webhook interno é bloqueado e o público é chamado", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const realFetch = globalThis.fetch;
  const chamadas: Array<{ url: string; corpo: Record<string, unknown>; redirect?: string }> = [];
  try {
    globalThis.fetch = (async (url: string, init?: RequestInit) => { chamadas.push({ url: String(url), corpo: JSON.parse(String(init?.body)), redirect: init?.redirect }); return new Response("ok", { status: 200 }); }) as typeof fetch;
    const a = await prisma.automacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_CRIADA", criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }], acoes: [
      { tipo: "DISPARAR_WEBHOOK", url: "https://127.0.0.1/interno", esperaHoras: 0 },
      { tipo: "DISPARAR_WEBHOOK", url: "https://203.0.113.10/hook", esperaHoras: 0 },
      { tipo: "MOVER_ETAPA", etapaId: "etapa-que-sumiu", esperaHoras: 0 },
      { tipo: "REGISTRAR_ALERTA", mensagem: "ainda roda", esperaHoras: 0 },
    ] } as never });
    ids.push(a.id);
    const op = await criarOportunidade({ nome: "Erros", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 1500, tags: ["t"] });
    const ex = await prisma.automacaoExecucao.findMany({ where: { automacaoId: a.id }, orderBy: { indice: "asc" } });
    assert.deepEqual(ex.map((e) => e.status), ["ERRO", "EXECUTADA", "ERRO", "EXECUTADA"]);
    assert.match(ex[0].detalhe!, /Endereço interno não permitido/);
    assert.match(ex[2].detalhe!, /Etapa não encontrada/);
    assert.equal(chamadas.length, 1, "o endereço interno nunca foi chamado");
    assert.equal(chamadas[0].url, "https://203.0.113.10/hook");
    assert.equal(chamadas[0].redirect, "manual", "não segue redirecionamento");
    const corpo = chamadas[0].corpo as { gatilho: string; automacao: { nome: string }; oportunidade: { nome: string; funil: string; etapa: string; valorTotal: number; contato: { nome: string } } };
    assert.deepEqual([corpo.gatilho, corpo.oportunidade.nome, corpo.oportunidade.funil, corpo.oportunidade.etapa, corpo.oportunidade.valorTotal, corpo.oportunidade.contato.nome], ["OPORTUNIDADE_CRIADA", "Erros", c.funil.nome, "Leads", 1500, c.contato.nome]);
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: op.id, texto: "ainda roda" } }), 1);

    // webhook que responde 500 vira ERRO
    globalThis.fetch = (async () => new Response("x", { status: 500 })) as typeof fetch;
    const b = await prisma.automacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_CRIADA", criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }], acoes: [{ tipo: "DISPARAR_WEBHOOK", url: "https://203.0.113.10/hook", esperaHoras: 0 }] } as never });
    ids.push(b.id);
    await criarOportunidade({ nome: "Erro 500", contatoId: c.contato.id, funilId: c.funil.id });
    assert.match((await prisma.automacaoExecucao.findFirst({ where: { automacaoId: b.id } }))!.detalhe!, /HTTP 500/);
  } finally { globalThis.fetch = realFetch; await prisma.automacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

test("rotas: sessão, validação, etapa inexistente, ativar/desativar revalida, execuções, varrer e cron", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "Aut", email: `a${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const req = (url: string, metodo = "GET", corpo?: unknown, logado = true, extra: Record<string, string> = {}) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(logado ? { cookie } : {}), ...extra }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const p = (id: string) => ({ params: Promise.resolve({ id }) });
  const ids: string[] = [];
  const corpoOk = { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_MOVIDA", criterios: [{ campo: "etapaId", operador: "=", valor: c.qualif.id }], acoes: [{ tipo: "ADICIONAR_TAG", tag: "Qualificado" }] };
  try {
    assert.equal((await getLista(req("/api/automacoes", "GET", undefined, false))).status, 401);
    assert.equal((await postAuto(req("/api/automacoes", "POST", corpoOk, false))).status, 401);
    assert.equal((await postAuto(req("/api/automacoes", "POST", { ...corpoOk, acoes: [] }))).status, 400);
    assert.equal((await postAuto(req("/api/automacoes", "POST", { ...corpoOk, acoes: [{ tipo: "MOVER_ETAPA", etapaId: "nao-existe" }] }))).status, 400);
    assert.equal((await postAuto(req("/api/automacoes", "POST", { ...corpoOk, criterios: [{ campo: "etapaId", operador: "=", valor: "nao-existe" }] }))).status, 400);
    assert.equal((await postAuto(req("/api/automacoes", "POST", { ...corpoOk, acoes: [{ tipo: "DISPARAR_WEBHOOK", url: "http://inseguro.com" }] }))).status, 400);
    const criada = await postAuto(req("/api/automacoes", "POST", corpoOk));
    assert.equal(criada.status, 201);
    const { id } = await criada.json(); ids.push(id);
    const lista = await (await getLista(req("/api/automacoes"))).json();
    const a = lista.automacoes.find((x: { id: string }) => x.id === id);
    assert.deepEqual([a.acoes[0].tag, a.execucoes], ["qualificado", { executadas: 0, pendentes: 0, ignoradas: 0, erros: 0 }], "tag normalizada");

    // desativar e reativar mantêm o resto; PATCH inválido não corrompe
    assert.equal((await patchAuto(req(`/api/automacoes/${id}`, "PATCH", { ativo: false }), p(id))).status, 200);
    assert.equal((await prisma.automacao.findUnique({ where: { id } }))!.ativo, false);
    assert.equal((await patchAuto(req(`/api/automacoes/${id}`, "PATCH", { gatilho: "OPORTUNIDADE_ESTAGNADA" }), p(id))).status, 400, "estagnada exige critério de dias");
    assert.equal((await prisma.automacao.findUnique({ where: { id } }))!.gatilho, "OPORTUNIDADE_MOVIDA", "PATCH inválido não altera");
    assert.equal((await patchAuto(req("/api/automacoes/x", "PATCH", { ativo: true }), p("x"))).status, 404);
    await patchAuto(req(`/api/automacoes/${id}`, "PATCH", { ativo: true, nome: "Renomeada" }), p(id));
    assert.deepEqual((await prisma.automacao.findUnique({ where: { id } }).then((x) => [x!.nome, x!.ativo, (x!.acoes as { tag: string }[])[0].tag])), ["Renomeada", true, "qualificado"]);

    // execuções
    const op = await criarOportunidade({ nome: "Rota", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" });
    const ex = await (await getExec(req(`/api/automacoes/${id}/execucoes`), p(id))).json();
    assert.deepEqual([ex.execucoes.length, ex.execucoes[0].status, ex.execucoes[0].oportunidade], [1, "EXECUTADA", "Rota"]);
    assert.equal((await getExec(req("/x", "GET", undefined, false), p(id))).status, 401);

    // varrer e cron
    assert.equal((await postVarrer(req("/api/automacoes/varrer", "POST", undefined, false))).status, 401);
    const v = await (await postVarrer(req("/api/automacoes/varrer", "POST"))).json();
    assert.ok(typeof v.varredura.avaliadas === "number" && typeof v.execucao.executadas === "number");
    delete process.env.CRON_SECRET;
    assert.equal((await getCron(req("/api/cron/automacoes", "GET", undefined, false))).status, 503, "sem segredo configurado: desligado");
    process.env.CRON_SECRET = "segredo-do-cron-com-16+";
    assert.equal((await getCron(req("/api/cron/automacoes", "GET", undefined, false))).status, 401);
    assert.equal((await getCron(req("/api/cron/automacoes", "GET", undefined, false, { authorization: "Bearer errado-errado-errado" }))).status, 401);
    assert.equal((await getCron(req("/api/cron/automacoes", "GET", undefined, true))).status, 401, "cookie de sessão não vale no cron");
    assert.equal((await getCron(req("/api/cron/automacoes", "GET", undefined, false, { authorization: "Bearer segredo-do-cron-com-16+" }))).status, 200);

    assert.equal((await delAuto(req("/x", "DELETE"), p("x"))).status, 404);
    assert.equal((await delAuto(req("/x", "DELETE"), p(id))).status, 200);
    assert.equal(await prisma.automacaoExecucao.count({ where: { automacaoId: id } }), 0, "execuções caem junto");
  } finally { delete process.env.CRON_SECRET; await prisma.automacao.deleteMany({ where: { id: { in: ids } } }); await prisma.usuario.delete({ where: { id: u.id } }).catch(() => {}); await c.limpar(); }
});
