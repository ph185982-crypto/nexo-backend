import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { concluirTarefa, contarVisoes, criarTarefa, listarTarefas, normalizarChecklist } from "@/lib/atividades/tarefas";
import { calcularSaude, registrarFeedback } from "@/lib/atividades/feedback";
import { criarCompromisso } from "@/lib/atividades/compromissos";
import { limitesDoDia, somarRecorrencia } from "@/lib/atividades/tempo";
import { INTENCOES, PESO_INTENCAO, ROTULO_INTENCAO } from "@/lib/atividades/intencoes";
import { montarQuadro } from "@/lib/funil/quadro";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getTarefas, POST as postTarefa } from "@/app/api/tarefas/route";
import { PATCH as patchTarefa } from "@/app/api/tarefas/[id]/route";
import { GET as getFeedbacks, POST as postFeedback } from "@/app/api/oportunidades/[id]/feedbacks/route";
import { POST as postCompromisso, GET as getCompromissos } from "@/app/api/compromissos/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const DIA = 86_400_000;

test("dia em Brasília e recorrência", () => {
  const { inicio, fim } = limitesDoDia(new Date("2026-11-03T02:30:00Z")); // 02/11 23:30 em Brasília
  assert.equal(inicio.toISOString(), "2026-11-02T03:00:00.000Z");
  assert.equal(fim.getTime() - inicio.getTime(), DIA);
  assert.equal(limitesDoDia(new Date("2026-11-03T03:00:00Z")).inicio.toISOString(), "2026-11-03T03:00:00.000Z", "virada exata do dia");
  assert.equal(somarRecorrencia(new Date("2026-01-31T12:00:00Z"), "DIARIA").toISOString(), "2026-02-01T12:00:00.000Z");
  assert.equal(somarRecorrencia(new Date("2026-01-10T12:00:00Z"), "SEMANAL").toISOString(), "2026-01-17T12:00:00.000Z");
  assert.equal(somarRecorrencia(new Date("2026-01-10T12:00:00Z"), "MENSAL").toISOString(), "2026-02-10T12:00:00.000Z");
});

test("13 intenções com rótulo e peso; checklist saneado", () => {
  assert.equal(INTENCOES.length, 13);
  for (const i of INTENCOES) assert.ok(ROTULO_INTENCAO[i] && typeof PESO_INTENCAO[i] === "number");
  assert.deepEqual(normalizarChecklist([{ texto: " a ", feito: true }, { texto: "" }, { texto: "b", feito: "sim" }, 3, null]), [{ texto: "a", feito: true }, { texto: "b", feito: false }]);
  assert.deepEqual(normalizarChecklist("x"), []);
  assert.equal(normalizarChecklist(Array.from({ length: 80 }, () => ({ texto: "t" }))).length, 50);
});

test("saúde do negócio: sinais somam, parado desconta, limites 0–100", () => {
  assert.deepEqual(calcularSaude([], 0), { nota: 50, rotulo: "MORNA" });
  assert.equal(calcularSaude(["SINAL_FECHAMENTO", "DECISOR_ENGAJADO"], 0).rotulo, "QUENTE");
  assert.equal(calcularSaude(["SEM_RETORNO", "DECISAO_ADIADA"], 0).nota, 30);
  assert.equal(calcularSaude([], 30).nota, 27);
  assert.equal(calcularSaude(["SEM_RETORNO", "NAO_COMPARECEU", "DECISAO_ADIADA"], 40).rotulo, "RISCO_ALTO");
  assert.equal(calcularSaude(Array(20).fill("SINAL_FECHAMENTO"), 0).nota, 100);
  assert.equal(calcularSaude(Array(20).fill("NAO_COMPARECEU"), 90).nota, 0);
  assert.equal(calcularSaude([null, "INEXISTENTE"], 0).nota, 50, "valor desconhecido não pesa");
});

test("tarefa herda contato; concluir é idempotente; recorrente gera a próxima no futuro", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "T", contatoId: c.contato.id, funilId: c.funil.id });
    const t = await criarTarefa({ titulo: "Ligar", oportunidadeId: op.id, prazoEm: new Date(Date.now() - 3 * DIA), recorrencia: "SEMANAL", checklist: [{ texto: "x", feito: true }] });
    assert.equal(t.contatoId, c.contato.id);
    const antes = (await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.ultimaAtividadeEm;
    await new Promise((r) => setTimeout(r, 15));
    const r1 = await concluirTarefa(t.id);
    assert.equal(r1.tarefa.status, "CONCLUIDA");
    assert.ok(r1.proxima && r1.proxima.prazoEm! > new Date(), "próxima nunca nasce vencida");
    assert.deepEqual(r1.proxima!.checklist, [{ texto: "x", feito: false }], "checklist zerado");
    assert.equal(r1.proxima!.status, "ABERTA");
    assert.ok((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.ultimaAtividadeEm > antes);
    const r2 = await concluirTarefa(t.id);
    assert.equal(r2.proxima, null, "segunda conclusão não duplica");
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op.id } }), 2);
    await assert.rejects(concluirTarefa("nao-existe"), /Tarefa não encontrada/);
    await c.prisma.tarefa.deleteMany({ where: { oportunidadeId: op.id } });
  } finally { await c.limpar(); }
});

test("visões de tarefas: hoje, atrasadas, próximos 7 dias, abertas, concluídas", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "U", email: `v${c.marca}@t.local`, senhaHash: "x" } });
  const agora = new Date("2026-11-03T15:00:00Z"); // 12h em Brasília
  const { inicio } = limitesDoDia(agora);
  const mk = (titulo: string, prazoEm: Date | null) => criarTarefa({ titulo, prazoEm, responsavelId: u.id });
  try {
    const ids = {
      ontem: (await mk("ontem", new Date(inicio.getTime() - 3_600_000))).id,
      hoje: (await mk("hoje", new Date(inicio.getTime() + 20 * 3_600_000))).id,
      em3: (await mk("em3", new Date(inicio.getTime() + 3 * DIA + 3_600_000))).id,
      em10: (await mk("em10", new Date(inicio.getTime() + 10 * DIA))).id,
      sem: (await mk("sem prazo", null)).id,
      feita: (await mk("feita", new Date(inicio.getTime() + DIA))).id,
    };
    await concluirTarefa(ids.feita, agora);
    await criarTarefa({ titulo: "de outro", prazoEm: new Date(inicio.getTime() + 3_600_000) }); // sem responsável
    const nomes = async (visao: "hoje") => (await listarTarefas({ visao, responsavelId: u.id, agora })).map((t) => t.titulo);
    assert.deepEqual(await nomes("hoje"), ["hoje"]);
    assert.deepEqual((await listarTarefas({ visao: "atrasadas", responsavelId: u.id, agora })).map((t) => t.titulo), ["ontem"]);
    assert.deepEqual((await listarTarefas({ visao: "proximos7", responsavelId: u.id, agora })).map((t) => t.titulo), ["hoje", "em3"]);
    assert.deepEqual((await listarTarefas({ visao: "abertas", responsavelId: u.id, agora })).map((t) => t.titulo), ["ontem", "hoje", "em3", "em10", "sem prazo"], "ordena por prazo, sem prazo por último");
    assert.deepEqual((await listarTarefas({ visao: "concluidas", responsavelId: u.id, agora })).map((t) => t.titulo), ["feita"]);
    assert.deepEqual(await contarVisoes(u.id, agora), { hoje: 1, atrasadas: 1, proximos7: 2, abertas: 5, concluidas: 1 });
  } finally {
    await prisma.tarefa.deleteMany({ where: { OR: [{ responsavelId: u.id }, { titulo: "de outro" }] } });
    await prisma.usuario.delete({ where: { id: u.id } }); await c.limpar();
  }
});

test("feedback: interação zera 'sem atividade', evento de sistema não; compromisso valida horário", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "F", contatoId: c.contato.id, funilId: c.funil.id });
    const velho = new Date(Date.now() - 20 * DIA);
    await prisma.oportunidade.update({ where: { id: op.id }, data: { ultimaAtividadeEm: velho } });
    await registrarFeedback({ oportunidadeId: op.id, tipo: "SISTEMA", texto: "movida" });
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.ultimaAtividadeEm.getTime(), velho.getTime());
    const f = await registrarFeedback({ oportunidadeId: op.id, tipo: "LIGACAO", texto: "falei com o dono", intencao: "DECISOR_ENGAJADO", autor: "u1" });
    assert.equal(f.contatoId, c.contato.id);
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.ultimaAtividadeEm.getTime(), f.criadoEm.getTime());

    const ini = new Date(Date.now() + DIA);
    await assert.rejects(criarCompromisso({ assunto: "x", inicio: ini, fim: ini }), /fim precisa ser depois/);
    const comp = await criarCompromisso({ assunto: "Reunião", inicio: ini, fim: new Date(ini.getTime() + 3_600_000), oportunidadeId: op.id });
    assert.equal(comp.contatoId, c.contato.id);

    const q = (await montarQuadro(c.funil.id))!;
    const card = q.etapas[0].oportunidades.find((x) => x.id === op.id)!;
    assert.deepEqual([card.proximaAtividade?.tipo, card.proximaAtividade?.quando], ["COMPROMISSO", comp.inicio.toISOString()]);
    await criarTarefa({ titulo: "antes", oportunidadeId: op.id, prazoEm: new Date(ini.getTime() - 3_600_000) });
    assert.equal((await montarQuadro(c.funil.id))!.etapas[0].oportunidades[0].proximaAtividade?.tipo, "TAREFA", "tarefa mais cedo vence");
    await c.prisma.tarefa.deleteMany({ where: { oportunidadeId: op.id } });
    await c.prisma.compromisso.deleteMany({ where: { oportunidadeId: op.id } });
    assert.equal((await montarQuadro(c.funil.id))!.etapas[0].oportunidades[0].proximaAtividade, null, "sem nada à vista");
  } finally { await c.limpar(); }
});

test("rotas: sem sessão 401, entrada inválida 400, criar/listar/concluir tarefa, feedback com saúde, compromisso", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "Rota", email: `r${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const req = (url: string, metodo = "GET", corpo?: unknown, logado = true) =>
    new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(logado ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  try {
    const op = await criarOportunidade({ nome: "R", contatoId: c.contato.id, funilId: c.funil.id });
    assert.equal((await getTarefas(req("/api/tarefas", "GET", undefined, false))).status, 401);
    assert.equal((await postTarefa(req("/api/tarefas", "POST", { titulo: "x" }, false))).status, 401);
    assert.equal((await postTarefa(req("/api/tarefas", "POST", { titulo: "  " }))).status, 400);
    assert.equal((await postTarefa(req("/api/tarefas", "POST", { titulo: "x", prioridade: "URGENTE" }))).status, 400);
    assert.equal((await postTarefa(req("/api/tarefas", "POST", { titulo: "x", prazoEm: "ontem-ish" }))).status, 400);
    assert.equal((await postTarefa(req("/api/tarefas", "POST", { titulo: "x", oportunidadeId: "nao-existe" }))).status, 404);
    assert.equal((await getTarefas(req("/api/tarefas?visao=semana"))).status, 400);

    const criada = await postTarefa(req("/api/tarefas", "POST", { titulo: "Ligar para o dono", oportunidadeId: op.id, prazoEm: new Date(Date.now() + 3_600_000).toISOString(), prioridade: "ALTA", recorrencia: "DIARIA" }));
    assert.equal(criada.status, 201);
    const { id } = await criada.json();
    const lista = await (await getTarefas(req(`/api/tarefas?visao=abertas&oportunidadeId=${op.id}`))).json();
    assert.equal(lista.tarefas.length, 1);
    assert.equal(lista.tarefas[0].responsavelId, u.id, "responsável padrão = quem criou");
    assert.equal(lista.contadores.abertas, 1);

    const conc = await (await patchTarefa(req(`/api/tarefas/${id}`, "PATCH", { acao: "concluir" }), params(id))).json();
    assert.ok(conc.proximaId, "recorrente gera próxima");
    assert.equal((await patchTarefa(req("/api/tarefas/x", "PATCH", { acao: "concluir" }), params("x"))).status, 404);
    assert.equal((await patchTarefa(req(`/api/tarefas/${id}`, "PATCH", { prioridade: "NADA" }), params(id))).status, 400);

    // feedback
    assert.equal((await postFeedback(req(`/api/oportunidades/${op.id}/feedbacks`, "POST", { texto: "", tipo: "NOTA" }), params(op.id))).status, 400);
    assert.equal((await postFeedback(req(`/api/oportunidades/${op.id}/feedbacks`, "POST", { texto: "x", intencao: "INVENTADA" }), params(op.id))).status, 400);
    assert.equal((await postFeedback(req(`/api/oportunidades/${op.id}/feedbacks`, "POST", { texto: "x", tipo: "SISTEMA" }), params(op.id))).status, 400, "cliente não cria evento de sistema");
    assert.equal((await postFeedback(req("/api/oportunidades/x/feedbacks", "POST", { texto: "x" }), params("x"))).status, 404);
    assert.equal((await postFeedback(req(`/api/oportunidades/${op.id}/feedbacks`, "POST", { texto: "Dono pediu proposta", tipo: "LIGACAO", intencao: "SINAL_FECHAMENTO", importante: true }), params(op.id))).status, 201);
    const fb = await (await getFeedbacks(req(`/api/oportunidades/${op.id}/feedbacks`), params(op.id))).json();
    assert.equal(fb.feedbacks.length, 1);
    assert.equal(fb.feedbacks[0].autorNome, "Rota");
    assert.deepEqual(fb.saude, { nota: 70, rotulo: "QUENTE" });

    // compromisso
    const ini = new Date(Date.now() + DIA);
    const body = { assunto: "Diagnóstico", inicio: ini.toISOString(), fim: new Date(ini.getTime() + 3_600_000).toISOString(), oportunidadeId: op.id, participantes: ["a@b.com", "lixo", "c@d.com"] };
    assert.equal((await postCompromisso(req("/api/compromissos", "POST", { ...body, fim: body.inicio }))).status, 400);
    assert.equal((await postCompromisso(req("/api/compromissos", "POST", body))).status, 201);
    const lc = await (await getCompromissos(req(`/api/compromissos?de=${new Date().toISOString()}&ate=${new Date(Date.now() + 3 * DIA).toISOString()}`))).json();
    assert.deepEqual(lc.compromissos[0].participantes, ["a@b.com", "c@d.com"], "e-mail inválido descartado");
    assert.equal((await getCompromissos(req(`/api/compromissos?de=2026-01-01&ate=2026-12-31`))).status, 400, "intervalo máximo");
  } finally {
    await prisma.tarefa.deleteMany({ where: { OR: [{ responsavelId: u.id }, { oportunidade: { funilId: c.funil.id } }] } });
    await prisma.compromisso.deleteMany({ where: { oportunidade: { funilId: c.funil.id } } });
    await prisma.usuario.delete({ where: { id: u.id } }).catch(() => {});
    await c.limpar();
  }
});
