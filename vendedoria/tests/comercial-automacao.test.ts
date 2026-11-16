import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_comercial-cenario";
import { prisma } from "@/lib/prisma/client";
import { criarOportunidade, moverOportunidade } from "@/lib/comercial/funil/mover";
import { validarAcao, validarAutomacao, normalizarTag } from "@/lib/comercial/automacao/modelo";
import { avaliarCriterios, type ContextoOportunidade } from "@/lib/comercial/automacao/criterios";
import https from "node:https";
import { enviarWebhook, ipPrivado, lookupSeguro, verificarUrlWebhook } from "@/lib/comercial/automacao/url-segura";
import { dispararEvento, processarVencidas, varrerTempo } from "@/lib/comercial/automacao/motor";

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
    const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}:${gatilho}`, gatilho, criterios, acoes } as never }); criadas.push(a.id); return a; };
    const tarefa = (titulo: string) => [{ tipo: "CRIAR_TAREFA", titulo, prazoHoras: 2, prioridade: "ALTA", tipoTarefa: "LIGACAO", esperaHoras: 0 }];
    const aCriada = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("boas-vindas"));
    const aQualif = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.qualif.id }], tarefa("qualificou"));
    const aGanha = await mk("OPORTUNIDADE_GANHA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("cobrar 1º pagamento"));
    const aPerdida = await mk("OPORTUNIDADE_PERDIDA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "perdemos", esperaHoras: 0 }]);
    const aInativa = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], tarefa("nunca"));
    await prisma.comAutomacao.update({ where: { id: aInativa.id }, data: { ativo: false } });
    const titulos = async (opId: string) => (await prisma.comTarefa.findMany({ where: { oportunidadeId: opId }, orderBy: { criadoEm: "asc" } })).map((t) => t.titulo);

    const op = await criarOportunidade({ nome: "M1", contatoId: c.contato.id, funilId: c.funil.id, responsavelId: null });
    assert.deepEqual(await titulos(op.id), ["boas-vindas"], "criada dispara só a de criação");
    const t = (await prisma.comTarefa.findFirst({ where: { oportunidadeId: op.id } }))!;
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
    const alerta = await prisma.comFeedback.findFirst({ where: { oportunidadeId: p.id, autor: "automacao" } });
    assert.deepEqual([alerta?.texto, alerta?.importante, alerta?.tipo, alerta?.autorNome], ["perdemos", true, "SISTEMA", aPerdida.nome]);
    const ex = await prisma.comAutomacaoExecucao.findMany({ where: { automacaoId: aCriada.id } });
    assert.deepEqual([ex.length >= 2, ex.every((e) => e.status === "EXECUTADA" && e.detalhe?.startsWith("Tarefa criada"))], [true, true]);
    assert.equal(aQualif.id !== aGanha.id, true);
  } finally { await prisma.comAutomacao.deleteMany({ where: { id: { in: criadas } } }); await c.limpar(); }
});

test("motor: espera reconfere critérios; ação de automação não encadeia; tag e alerta idempotentes", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho, criterios, acoes } as never }); ids.push(a.id); return a; };
  try {
    // 1) espera: executa só se ainda estiver na etapa
    const aEspera = await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.qualif.id }], [{ tipo: "CRIAR_TAREFA", titulo: "cobrar retorno", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 48 }]);
    const ficou = await criarOportunidade({ nome: "Ficou", contatoId: c.contato.id, funilId: c.funil.id });
    const saiu = await criarOportunidade({ nome: "Saiu", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: ficou.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: saiu.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: saiu.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: { in: [ficou.id, saiu.id] } } }), 0, "espera: nada ainda");
    const pend = await prisma.comAutomacaoExecucao.findMany({ where: { automacaoId: aEspera.id } });
    assert.deepEqual([pend.length, pend.every((e) => e.status === "PENDENTE" && e.executarEm.getTime() > Date.now() + 47 * H)], [2, true]);
    assert.deepEqual(await processarVencidas(new Date(Date.now() + 10 * H)), { executadas: 0, ignoradas: 0, erros: 0 }, "antes do prazo nada roda");
    const r = await processarVencidas(new Date(Date.now() + 49 * H));
    assert.deepEqual([r.executadas, r.ignoradas], [1, 1]);
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: ficou.id } }), 1);
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: saiu.id } }), 0);
    assert.match((await prisma.comAutomacaoExecucao.findFirst({ where: { oportunidadeId: saiu.id } }))!.detalhe!, /critérios não valiam mais/);

    // 2) sem laço: A move para Proposta; B (movida p/ Proposta) NÃO roda por causa do movimento de A
    await prisma.comAutomacao.deleteMany({ where: { id: aEspera.id } });
    await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.leads.id }], [{ tipo: "MOVER_ETAPA", etapaId: c.proposta.id, esperaHoras: 0 }]);
    await mk("OPORTUNIDADE_MOVIDA", [{ campo: "etapaId", operador: "=", valor: c.proposta.id }], [{ tipo: "CRIAR_TAREFA", titulo: "encadeada", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 0 }]);
    const op = await criarOportunidade({ nome: "Cadeia", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" }); // sai de Leads: nenhuma casa
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.leads.id, origem: "MANUAL" }); // volta a Leads: A move p/ Proposta
    const dep = (await prisma.comOportunidade.findUnique({ where: { id: op.id }, include: { etapa: true } }))!;
    assert.equal(dep.etapa.nome, "Proposta e negociação", "A moveu");
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: op.id, titulo: "encadeada" } }), 0, "B não disparou a partir da ação de A");
    const h = await c.historico(op.id);
    assert.deepEqual([h.at(-1)!.origem, h.at(-1)!.ator, h.at(-1)!.motivo?.startsWith("Automação:")], ["AUTOMACAO", "automacao", true]);
    // mas um movimento humano para Proposta dispara B normalmente
    const op2 = await criarOportunidade({ nome: "Humano", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op2.id, etapaId: c.proposta.id, origem: "MANUAL" });
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: op2.id, titulo: "encadeada" } }), 1);

    // 3) tag idempotente e alerta
    const aTag = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "ADICIONAR_TAG", tag: "novo-lead", esperaHoras: 0 }, { tipo: "ADICIONAR_TAG", tag: "novo-lead", esperaHoras: 0 }]);
    const t = await criarOportunidade({ nome: "Tag", contatoId: c.contato.id, funilId: c.funil.id, tags: ["x"] });
    assert.deepEqual((await prisma.comOportunidade.findUnique({ where: { id: t.id } }))!.tags, ["x", "novo-lead"]);
    const det = (await prisma.comAutomacaoExecucao.findMany({ where: { automacaoId: aTag.id }, orderBy: { indice: "asc" } })).map((e) => e.detalhe);
    assert.deepEqual(det, ["Tag #novo-lead adicionada", "Tag já existia"]);
  } finally { await prisma.comAutomacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

test("motor: varredura de tempo (parada na etapa, sem interação), uma vez por fato; concorrência; recuperação", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => { const a = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho, criterios, acoes } as never }); ids.push(a.id); return a; };
  try {
    const parada = await mk("OPORTUNIDADE_ESTAGNADA", [{ campo: "diasNaEtapa", operador: ">=", valor: 3 }, { campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "CRIAR_TAREFA", titulo: "destravar", prazoHoras: 4, prioridade: "ALTA", tipoTarefa: "LIGACAO", esperaHoras: 0 }]);
    const muda = await mk("OPORTUNIDADE_SEM_INTERACAO", [{ campo: "diasSemAtividade", operador: ">=", valor: 7 }, { campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "cliente sumiu", esperaHoras: 0 }]);
    const velha = await criarOportunidade({ nome: "Velha", contatoId: c.contato.id, funilId: c.funil.id });
    const nova_ = await criarOportunidade({ nome: "Nova", contatoId: c.contato.id, funilId: c.funil.id });
    const ganha = await criarOportunidade({ nome: "Ganha antiga", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: ganha.id, etapaId: c.ganha.id, origem: "MANUAL" });
    await prisma.comOportunidade.updateMany({ where: { id: { in: [velha.id, ganha.id] } }, data: { etapaDesdeEm: new Date(Date.now() - 5 * DIA), ultimaAtividadeEm: new Date(Date.now() - 10 * DIA) } });

    const v1 = await varrerTempo();
    assert.equal(v1.agendadas >= 2, true);
    await processarVencidas();
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 1, "velha: tarefa");
    assert.equal(await prisma.comFeedback.count({ where: { oportunidadeId: velha.id, texto: "cliente sumiu" } }), 1, "velha: alerta");
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: nova_.id } }), 0, "nova não casa");
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: ganha.id } }), 0, "ganha não é varrida (só em andamento)");

    await varrerTempo(); await varrerTempo(); await processarVencidas();
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 1, "uma vez por permanência na etapa");
    // sai da etapa e volta a ficar parada: fato novo
    await moverOportunidade({ oportunidadeId: velha.id, etapaId: c.qualif.id, origem: "MANUAL" });
    await prisma.comOportunidade.update({ where: { id: velha.id }, data: { etapaDesdeEm: new Date(Date.now() - 4 * DIA) } });
    await varrerTempo(); await processarVencidas();
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: velha.id, titulo: "destravar" } }), 2);

    // desativada: nada agenda
    await prisma.comAutomacao.update({ where: { id: parada.id }, data: { ativo: false } });
    await prisma.comOportunidade.update({ where: { id: velha.id }, data: { etapaDesdeEm: new Date(Date.now() - 9 * DIA) } });
    const v0 = await varrerTempo();
    assert.deepEqual([v0.avaliadas, v0.agendadas], [await prisma.comOportunidade.count({ where: { status: "EM_ANDAMENTO" } }), 0]);
    assert.equal(muda.id !== parada.id, true);

    // concorrência: duas rodadas simultâneas, uma execução só
    const k = await mk("OPORTUNIDADE_CRIADA", [{ campo: "funilId", operador: "=", valor: c.funil.id }], [{ tipo: "CRIAR_TAREFA", titulo: "uma só", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 1 }]);
    const op = await criarOportunidade({ nome: "Conc", contatoId: c.contato.id, funilId: c.funil.id });
    const quando = new Date(Date.now() + 2 * H);
    await Promise.all([processarVencidas(quando), processarVencidas(quando), processarVencidas(quando)]);
    assert.equal(await prisma.comTarefa.count({ where: { oportunidadeId: op.id, titulo: "uma só" } }), 1);

    // recuperação: linha reivindicada há muito tempo e nunca concluída volta à fila
    const travada = await prisma.comAutomacaoExecucao.create({ data: { automacaoId: k.id, oportunidadeId: op.id, gatilho: "OPORTUNIDADE_CRIADA", indice: 0, acaoTipo: "CRIAR_TAREFA", chave: `travada:${c.marca}`, status: "EXECUTANDO", executarEm: new Date(Date.now() - 30 * 60_000) } });
    await processarVencidas();
    assert.notEqual((await prisma.comAutomacaoExecucao.findUnique({ where: { id: travada.id } }))!.status, "EXECUTANDO");
  } finally { await prisma.comAutomacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

/** Troca https.request por um falso que devolve `status` e guarda o que foi enviado. */
function transporteFalso(status: number) {
  const chamadas: Array<{ url: string; opcoes: Record<string, unknown>; corpo: Record<string, unknown> }> = [];
  const original = https.request;
  (https as unknown as { request: unknown }).request = (url: string, opcoes: Record<string, unknown>, cb: (res: unknown) => void) => {
    const ouvintes: Record<string, (...x: unknown[]) => void> = {};
    return {
      on(ev: string, fn: (...x: unknown[]) => void) { ouvintes[ev] = fn; return this; },
      end(corpo: string) {
        chamadas.push({ url: String(url), opcoes, corpo: JSON.parse(corpo) });
        const fim: Record<string, () => void> = {};
        cb({ statusCode: status, resume() {}, on(ev: string, fn: () => void) { fim[ev] = fn; return this; } });
        setImmediate(() => fim.end?.());
      },
      destroy() {},
    };
  };
  return { chamadas, restaurar: () => { (https as unknown as { request: unknown }).request = original; } };
}

test("lookup seguro barra IP interno na conexão (anti DNS rebinding)", async () => {
  const resolver = (host: string, todos = false) => new Promise<{ err: Error | null; r: unknown }>((ok) => lookupSeguro(host, { all: todos }, (err, r) => ok({ err, r })));
  const local = await resolver("localhost");
  assert.match(local.err?.message ?? "", /Endereço interno não permitido/, "localhost resolve para 127.0.0.1 e é barrado");
  assert.match((await resolver("localhost", true)).err?.message ?? "", /Endereço interno/, "também com all:true");
  assert.match((await resolver("127.0.0.1")).err?.message ?? "", /Endereço interno/);
  assert.match((await resolver("169.254.169.254")).err?.message ?? "", /Endereço interno/, "metadados de nuvem");
  const publico = await resolver("203.0.113.10");
  assert.equal(publico.err, null);
  assert.equal(publico.r, "203.0.113.10");
  const lista = await resolver("203.0.113.10", true);
  assert.deepEqual((lista.r as Array<{ address: string }>).map((x) => x.address), ["203.0.113.10"]);
  await assert.rejects(enviarWebhook("https://localhost:9/x", "{}", 3000), /Endereço interno não permitido/, "conexão real a localhost nem chega a abrir");
});

test("ações com erro viram ERRO sem derrubar as demais; webhook interno é bloqueado e o público é chamado", async () => {
  const c = await cenario();
  const ids: string[] = [];
  const t = transporteFalso(200);
  try {
    const a = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_CRIADA", criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }], acoes: [
      { tipo: "DISPARAR_WEBHOOK", url: "https://127.0.0.1/interno", esperaHoras: 0 },
      { tipo: "DISPARAR_WEBHOOK", url: "https://203.0.113.10/hook", esperaHoras: 0 },
      { tipo: "MOVER_ETAPA", etapaId: "etapa-que-sumiu", esperaHoras: 0 },
      { tipo: "REGISTRAR_ALERTA", mensagem: "ainda roda", esperaHoras: 0 },
    ] } as never });
    ids.push(a.id);
    const op = await criarOportunidade({ nome: "Erros", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 1500, tags: ["t"] });
    // Na requisição só rodam as ações rápidas; o webhook fica para depois da resposta (fora de requisição, para a rodada seguinte).
    const na_hora = await prisma.comAutomacaoExecucao.findMany({ where: { automacaoId: a.id }, orderBy: { indice: "asc" } });
    assert.deepEqual(na_hora.map((e) => e.status), ["PENDENTE", "PENDENTE", "ERRO", "EXECUTADA"], "webhooks aguardam; as ações de banco já rodaram");
    assert.equal(t.chamadas.length, 0, "nenhum webhook saiu dentro da requisição");
    await processarVencidas();
    const ex = await prisma.comAutomacaoExecucao.findMany({ where: { automacaoId: a.id }, orderBy: { indice: "asc" } });
    assert.deepEqual(ex.map((e) => e.status), ["ERRO", "EXECUTADA", "ERRO", "EXECUTADA"]);
    assert.match(ex[0].detalhe!, /Endereço interno não permitido/);
    assert.match(ex[2].detalhe!, /Etapa não encontrada/);
    assert.equal(t.chamadas.length, 1, "o endereço interno nunca foi chamado");
    assert.equal(t.chamadas[0].url, "https://203.0.113.10/hook");
    assert.equal(t.chamadas[0].opcoes.method, "POST");
    assert.equal(t.chamadas[0].opcoes.lookup, lookupSeguro, "a conexão usa o lookup que valida o IP");
    const corpo = t.chamadas[0].corpo as { gatilho: string; automacao: { nome: string }; oportunidade: { nome: string; funil: string; etapa: string; valorTotal: number; contato: { nome: string } } };
    assert.deepEqual([corpo.gatilho, corpo.oportunidade.nome, corpo.oportunidade.funil, corpo.oportunidade.etapa, corpo.oportunidade.valorTotal, corpo.oportunidade.contato.nome], ["OPORTUNIDADE_CRIADA", "Erros", c.funil.nome, "Leads", 1500, c.contato.nome]);
    assert.equal(await prisma.comFeedback.count({ where: { oportunidadeId: op.id, texto: "ainda roda" } }), 1);

    // 500 e 302 (redirecionamento não é seguido) viram ERRO
    for (const [status, re] of [[500, /HTTP 500/], [302, /HTTP 302/]] as const) {
      t.restaurar();
      const t2 = transporteFalso(status);
      const b = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_CRIADA", criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }], acoes: [{ tipo: "DISPARAR_WEBHOOK", url: "https://203.0.113.10/hook", esperaHoras: 0 }] } as never });
      ids.push(b.id);
      await criarOportunidade({ nome: `Erro ${status}`, contatoId: c.contato.id, funilId: c.funil.id });
      await processarVencidas();
      assert.match((await prisma.comAutomacaoExecucao.findFirst({ where: { automacaoId: b.id } }))!.detalhe!, re);
      t2.restaurar();
      await prisma.comAutomacao.delete({ where: { id: b.id } });
    }
  } finally { t.restaurar(); await prisma.comAutomacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); }
});

// (As rotas de automação ficam para a etapa das telas de prioridade 3: o teste de rotas do CRM volta junto.)

test("motor: evento só processa as linhas da própria oportunidade; tarefa sem responsável vai para o administrador", async () => {
  const { primeiroAdminAtivo } = await import("@/lib/comercial/auth/admin");
  const c = await cenario();
  const ids: string[] = [];
  let criouAdmin: string | null = null;
  try {
    if (!(await primeiroAdminAtivo())) criouAdmin = (await prisma.user.create({ data: { name: "Adm teste", email: `adm${c.marca}@t.local`, role: "ADMIN"} })).id;
    const admin = (await primeiroAdminAtivo())!;
    // uma linha vencida de OUTRA oportunidade não pode ser executada por causa deste evento
    const velha = await criarOportunidade({ nome: "Outra", contatoId: c.contato.id, funilId: c.funil.id });
    const a0 = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_MOVIDA", criterios: [{ campo: "etapaId", operador: "=", valor: c.proposta.id }], acoes: [{ tipo: "REGISTRAR_ALERTA", mensagem: "alheia", esperaHoras: 0 }] } as never });
    ids.push(a0.id);
    const pendenteAlheia = await prisma.comAutomacaoExecucao.create({ data: { automacaoId: a0.id, oportunidadeId: velha.id, gatilho: "OPORTUNIDADE_MOVIDA", indice: 0, acaoTipo: "REGISTRAR_ALERTA", chave: `alheia:${c.marca}`, executarEm: new Date(Date.now() - 3_600_000) } });

    const a1 = await prisma.comAutomacao.create({ data: { nome: `t:${c.funil.id}`, gatilho: "OPORTUNIDADE_CRIADA", criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }], acoes: [{ tipo: "CRIAR_TAREFA", titulo: "sem dono", prazoHoras: 1, prioridade: "NORMAL", tipoTarefa: "TAREFA", esperaHoras: 0 }] } as never });
    ids.push(a1.id);
    const semDono = await criarOportunidade({ nome: "Sem dono", contatoId: c.contato.id, funilId: c.funil.id, responsavelId: null });
    assert.equal((await prisma.comAutomacaoExecucao.findUnique({ where: { id: pendenteAlheia.id } }))!.status, "PENDENTE", "linha de outra oportunidade intocada");
    assert.equal((await prisma.comTarefa.findFirst({ where: { oportunidadeId: semDono.id } }))!.responsavelId, admin.id, "sem responsável: vai para o administrador");

    const u = await prisma.user.create({ data: { name: "Dona", email: `dona${c.marca}@t.local`} });
    try {
      const comDono = await criarOportunidade({ nome: "Com dono", contatoId: c.contato.id, funilId: c.funil.id, responsavelId: u.id });
      assert.equal((await prisma.comTarefa.findFirst({ where: { oportunidadeId: comDono.id } }))!.responsavelId, u.id, "com responsável: fica com ele");
    } finally { await prisma.comOportunidade.deleteMany({ where: { responsavelId: u.id } }); await prisma.user.delete({ where: { id: u.id } }); }
  } finally { await prisma.comAutomacao.deleteMany({ where: { id: { in: ids } } }); await c.limpar(); if (criouAdmin) await prisma.user.delete({ where: { id: criouAdmin } }); }
});

test("depoisDaResposta: fora de uma requisição devolve false (sem lançar)", async () => {
  const { depoisDaResposta } = await import("@/lib/comercial/segundo-plano");
  let rodou = false;
  assert.equal(depoisDaResposta(async () => { rodou = true; }), false);
  assert.equal(rodou, false);
});
