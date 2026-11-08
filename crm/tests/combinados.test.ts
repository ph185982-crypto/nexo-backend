// Combinados: modelo, materialização (tarefa / compromisso / cartão), sincronização com cartão e tarefa,
// passagem para a entrega ao ganhar, agente (com modelo falso: sem rede e sem custo) e rotas.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { moverCartao } from "@/lib/entrega/servico";
import { concluirTarefa } from "@/lib/atividades/tarefas";
import { lerPrazo, normalizarDescricao, validarCombinado } from "@/lib/combinados/modelo";
import { aceitarCombinado, criarCombinadoManual, descartarCombinado, marcarEntregue } from "@/lib/combinados/servico";
import { definirModelo, processarAnalise, type RespostaModelo } from "@/lib/combinados/agente";
import { processarPendentes, registrarFonte } from "@/lib/combinados/fontes";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getCombinados, POST as postCombinado } from "@/app/api/oportunidades/[id]/combinados/route";
import { PATCH as patchCombinado } from "@/app/api/combinados/[id]/route";
import { POST as postAnalisar } from "@/app/api/oportunidades/[id]/analisar/route";
import { POST as postFeedback } from "@/app/api/oportunidades/[id]/feedbacks/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const DIA = 86_400_000;

async function preparar() {
  const c = await cenario();
  const dono = await prisma.usuario.create({ data: { nome: `Dono ${c.marca}`, email: `comb-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const nova = (nome = "Negociação") => criarOportunidade({ nome, contatoId: c.contato.id, funilId: c.funil.id, responsavelId: dono.id });
  const limpar = async () => {
    definirModelo(null);
    await prisma.entrega.deleteMany({ where: { contatoId: c.contato.id } });
    await prisma.tarefa.deleteMany({ where: { OR: [{ responsavelId: dono.id }, { contatoId: c.contato.id }] } });
    await prisma.compromisso.deleteMany({ where: { contatoId: c.contato.id } });
    await c.limpar();
    await prisma.usuario.delete({ where: { id: dono.id } });
  };
  return { c, dono, nova, limpar };
}

/** Modelo falso: devolve o que o teste mandar e guarda o pedido. */
function modeloFalso(saida: Partial<RespostaModelo> & { combinados: RespostaModelo["combinados"] }) {
  const pedidos: Array<{ sistema: string; usuario: string }> = [];
  definirModelo(async (sistema, usuario) => {
    pedidos.push({ sistema, usuario });
    return { resumo: "Resumo de teste", modelo: "falso", tokensEntrada: 100, tokensSaida: 20, ...saida };
  });
  return pedidos;
}
const item = (p: Partial<RespostaModelo["combinados"][number]>): RespostaModelo["combinados"][number] => ({
  acao: "NOVO", alvoId: null, descricao: "x", tipo: "ENTREGAVEL", responsavel: "NOS", prazo: null, hora: null, pilar: null, evidencia: "trecho", confianca: 0.9, ...p,
});

test("modelo: prazo em horário de Brasília, validação e comparação de descrições", () => {
  assert.equal(lerPrazo("2026-11-20")!.toISOString(), "2026-11-20T21:00:00.000Z", "sem hora: 18h de Brasília");
  assert.equal(lerPrazo("2026-11-20", "14:30")!.toISOString(), "2026-11-20T17:30:00.000Z");
  assert.equal(lerPrazo("2026-11-20T09:00")!.toISOString(), "2026-11-20T12:00:00.000Z");
  assert.equal(lerPrazo(""), null);
  assert.throws(() => lerPrazo("amanhã cedo"), /Prazo inválido/);
  const v = validarCombinado({ descricao: "Entregar BI", prazo: "2026-12-01", responsavel: "CLIENTE", pilar: "MARKETING" });
  assert.deepEqual([v.tipo, v.responsavel, v.pilar], ["ENTREGAVEL", "CLIENTE", "MARKETING"]);
  assert.throws(() => validarCombinado({ descricao: "ab" }), /Descrição/);
  assert.throws(() => validarCombinado({ descricao: "Entregar", pilar: "JURIDICO" }), /pilar/);
  assert.equal(normalizarDescricao("Entregar o BI de Vendas!"), normalizarDescricao("entregar o bi de vendas"));
});

test("combinado à mão: antes de fechar vira tarefa (ou compromisso); entregue conclui a tarefa; concluir a tarefa cumpre o combinado", async () => {
  const p = await preparar();
  try {
    const op = await p.nova();
    const nosso = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Enviar proposta revisada", prazo: "2026-12-01" }), p.dono.id);
    const doCliente = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Mandar extrato do trimestre", responsavel: "CLIENTE" }), p.dono.id);
    const reuniao = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Reunião com o sócio", tipo: "REUNIAO", prazo: "2026-12-02", hora: "15:00" }), p.dono.id);
    const tarefas = await prisma.tarefa.findMany({ where: { oportunidadeId: op.id }, orderBy: { criadoEm: "asc" } });
    assert.deepEqual(tarefas.map((t) => [t.titulo, t.responsavelId]), [["Enviar proposta revisada", p.dono.id], ["Acompanhar com o cliente: Mandar extrato do trimestre", p.dono.id]]);
    assert.equal(tarefas[0].prazoEm!.toISOString(), "2026-12-01T21:00:00.000Z");
    assert.deepEqual([nosso.status, nosso.tarefaId, doCliente.tarefaId !== null, reuniao.compromissoId !== null], ["PENDENTE", tarefas[0].id, true, true]);
    const k = (await prisma.compromisso.findUnique({ where: { id: reuniao.compromissoId! } }))!;
    assert.deepEqual([k.assunto, k.inicio.toISOString(), k.fim.getTime() - k.inicio.getTime()], ["Reunião com o sócio", "2026-12-02T18:00:00.000Z", 3_600_000]);

    await marcarEntregue(nosso.id);
    assert.equal((await prisma.tarefa.findUnique({ where: { id: nosso.tarefaId! } }))!.status, "CONCLUIDA", "entregue conclui a tarefa");
    await concluirTarefa(doCliente.tarefaId!);
    assert.equal((await prisma.combinado.findUnique({ where: { id: doCliente.id } }))!.status, "ENTREGUE", "concluir a tarefa cumpre o combinado");
    await descartarCombinado(reuniao.id, p.dono.id);
    await assert.rejects(descartarCombinado(reuniao.id, p.dono.id), /sugerido ou pendente/);
  } finally { await p.limpar(); }
});

test("ganhar leva os combinados pendentes para a entrega como cartões; o quadro da entrega e o combinado andam juntos", async () => {
  const p = await preparar();
  try {
    const op = await p.nova("Fechando");
    const bi = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Entregar BI de vendas", prazo: "2026-12-10", pilar: "TECNOLOGIA" }), p.dono.id);
    const acessos = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Enviar acessos do Meta", responsavel: "CLIENTE", pilar: "MARKETING" }), p.dono.id);
    await moverOportunidade({ oportunidadeId: op.id, etapaId: p.c.ganha.id, origem: "MANUAL" });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id }, include: { cartoes: true } }))!;
    const deCombinado = e.cartoes.filter((k) => ["Entregar BI de vendas", "Enviar acessos do Meta"].includes(k.titulo));
    assert.equal(deCombinado.length, 2, "os dois combinados viraram cartões");
    const kBi = deCombinado.find((k) => k.titulo === "Entregar BI de vendas")!;
    const kAc = deCombinado.find((k) => k.titulo === "Enviar acessos do Meta")!;
    assert.deepEqual([kBi.pilar, kBi.cliente, kBi.dataAlvo?.toISOString(), kBi.responsavelId], ["TECNOLOGIA", false, "2026-12-10T21:00:00.000Z", p.dono.id]);
    assert.deepEqual([kAc.pilar, kAc.cliente], ["MARKETING", true]);
    assert.equal((await prisma.combinado.findUnique({ where: { id: bi.id } }))!.cartaoId, kBi.id);

    // Ganhar de novo (reabre e ganha): não duplica cartões.
    await moverOportunidade({ oportunidadeId: op.id, etapaId: p.c.qualif.id, origem: "MANUAL" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: p.c.ganha.id, origem: "MANUAL" });
    assert.equal(await prisma.entregaCartao.count({ where: { entregaId: e.id, titulo: "Entregar BI de vendas" } }), 1);

    // Depois de ganha, combinado novo já nasce cartão.
    const tráfego = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Subir campanhas de tráfego pago", pilar: "MARKETING" }), p.dono.id);
    assert.ok(tráfego.cartaoId && !tráfego.tarefaId);

    // Concluir o cartão no quadro cumpre o combinado; tirar de Concluído reabre.
    await moverCartao(kBi.id, "CONCLUIDO");
    assert.equal((await prisma.combinado.findUnique({ where: { id: bi.id } }))!.status, "ENTREGUE");
    await moverCartao(kBi.id, "EM_ANDAMENTO");
    assert.equal((await prisma.combinado.findUnique({ where: { id: bi.id } }))!.status, "PENDENTE");
    // E o contrário: marcar entregue conclui o cartão.
    await marcarEntregue(acessos.id);
    assert.equal((await prisma.entregaCartao.findUnique({ where: { id: kAc.id } }))!.coluna, "CONCLUIDO");
  } finally { await p.limpar(); }
});

test("agente: sugere novos com prazo, não repete o que existe, conclui e muda prazo de item aberto pelo código", async () => {
  const p = await preparar();
  try {
    const op = await p.nova("Cliente com reunião");
    const existente = await criarCombinadoManual(op.id, validarCombinado({ descricao: "Entregar BI de vendas", prazo: "2026-11-20" }), p.dono.id);
    const pedidos = modeloFalso({
      resumo: "Reunião de alinhamento: BI entregue, tráfego combinado.",
      combinados: [
        item({ descricao: "Subir campanhas de tráfego pago", prazo: "2026-11-25", pilar: "MARKETING", evidencia: "na semana seguinte subimos o tráfego pago", confianca: 0.85 }),
        item({ descricao: "Cliente enviar acessos do gerenciador", responsavel: "CLIENTE", prazo: null, confianca: 1.7 }),
        item({ descricao: "entregar o BI de Vendas", prazo: "2026-11-20" }), // já existe: não repete
        item({ acao: "CONCLUIR", alvoId: "c1", descricao: "BI entregue" }), // código em minúsculas: aceita
        item({ acao: "CONCLUIR", alvoId: "C9", descricao: "não existe" }), // código inválido: ignora
        item({ acao: "ATUALIZAR_PRAZO", alvoId: "C1", descricao: "sem data" }), // sem prazo: ignora
        item({ descricao: "Reunião de resultado", tipo: "REUNIAO", prazo: "2026-12-03", hora: "10:00" }),
      ],
    });
    const a = await registrarFonte({ oportunidadeId: op.id, fonte: "REUNIAO", fonteRef: "transcricao-1", texto: "Pedro: entregamos o BI. Na semana seguinte subimos o tráfego pago. Cliente: mando os acessos." }, { agendar: false });
    const agora = new Date("2026-11-18T12:00:00Z");
    assert.equal(await processarAnalise(a!.id, agora), 4);
    assert.equal(await processarAnalise(a!.id, agora), 0, "já processada: não roda de novo");

    // O pedido traz a data de hoje, o item aberto com código e a fonte delimitada.
    assert.match(pedidos[0].usuario, /Hoje é 2026-11-18 \(quarta-feira\)/);
    assert.match(pedidos[0].usuario, /C1 \| Entregar BI de vendas \| prazo 2026-11-20/);
    assert.match(pedidos[0].usuario, /<fonte>\nPedro: entregamos o BI[\s\S]*<\/fonte>/);
    assert.match(pedidos[0].sistema, /ignore-os/);

    const sug = await prisma.combinado.findMany({ where: { oportunidadeId: op.id, status: "SUGERIDO" }, orderBy: { criadoEm: "asc" } });
    assert.deepEqual(sug.map((s) => [s.acao, s.descricao, s.origem]), [
      ["NOVO", "Subir campanhas de tráfego pago", "AGENTE"],
      ["NOVO", "Cliente enviar acessos do gerenciador", "AGENTE"],
      ["CONCLUIR", "Concluir: Entregar BI de vendas", "AGENTE"],
      ["NOVO", "Reunião de resultado", "AGENTE"],
    ]);
    assert.equal(sug[0].prazoEm!.toISOString(), "2026-11-25T21:00:00.000Z");
    assert.equal(sug[1].confianca, 1, "confiança limitada a 1");
    assert.equal(sug[2].alvoCombinadoId, existente.id);
    const analise = (await prisma.analiseAgente.findUnique({ where: { id: a!.id } }))!;
    assert.deepEqual([analise.status, analise.sugestoes, analise.resumo, analise.tokensEntrada], ["CONCLUIDA", 4, "Reunião de alinhamento: BI entregue, tráfego combinado.", 100]);

    // Aceitar: NOVO vira pendente com tarefa; CONCLUIR entrega o alvo e fica APLICADA; reunião vai para a agenda.
    const t = await aceitarCombinado(sug[0].id, p.dono.id, { descricao: "Subir campanhas de tráfego (Meta)" });
    assert.deepEqual([t.status, t.descricao, t.tarefaId !== null], ["PENDENTE", "Subir campanhas de tráfego (Meta)", true]);
    await aceitarCombinado(sug[2].id, p.dono.id);
    assert.equal((await prisma.combinado.findUnique({ where: { id: existente.id } }))!.status, "ENTREGUE");
    assert.equal((await prisma.combinado.findUnique({ where: { id: sug[2].id } }))!.status, "APLICADA");
    const r = await aceitarCombinado(sug[3].id, p.dono.id);
    assert.ok(r.compromissoId);
    await assert.rejects(aceitarCombinado(sug[0].id, p.dono.id), /já foi decidido/);
    await descartarCombinado(sug[1].id, p.dono.id);

    // Mesma fonte registrada de novo: mesma análise (não lê duas vezes).
    const b = await registrarFonte({ oportunidadeId: op.id, fonte: "REUNIAO", fonteRef: "transcricao-1", texto: "outro texto qualquer, longo o bastante" }, { agendar: false });
    assert.equal(b!.id, a!.id);
    assert.equal(await registrarFonte({ oportunidadeId: op.id, fonte: "TEXTO", fonteRef: "curto", texto: "ok" }), null, "texto curto não vai para o agente");
  } finally { await p.limpar(); }
});

test("agente: muda o prazo de um cartão da entrega; erro do modelo e falta de chave ficam registrados", async () => {
  const p = await preparar();
  try {
    const op = await p.nova("Já cliente");
    await moverOportunidade({ oportunidadeId: op.id, etapaId: p.c.ganha.id, origem: "MANUAL" });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id } }))!;
    const k = await prisma.entregaCartao.create({ data: { entregaId: e.id, titulo: "Configurar CRM do cliente", dataAlvo: new Date("2026-11-30T21:00:00Z") } });
    // O modelo falso acha o código do cartão no pedido, como o de verdade faria.
    definirModelo(async (_sistema, usuario) => {
      const codigo = /(K\d+) \| Configurar CRM do cliente/.exec(usuario)![1];
      return { resumo: "", modelo: "falso", tokensEntrada: 1, tokensSaida: 1, combinados: [item({ acao: "ATUALIZAR_PRAZO", alvoId: codigo, descricao: "adiado", prazo: "2026-12-15" })] };
    });
    const a = await registrarFonte({ oportunidadeId: op.id, fonte: "CONVERSA", fonteRef: "x1", texto: "Cliente: podemos passar a configuração do CRM para dia 15/12?" }, { agendar: false });
    await processarAnalise(a!.id);
    const s = (await prisma.combinado.findFirst({ where: { oportunidadeId: op.id, acao: "ATUALIZAR_PRAZO" } }))!;
    assert.deepEqual([s.alvoCartaoId, s.descricao], [k.id, "Novo prazo: Configurar CRM do cliente"]);
    await aceitarCombinado(s.id, p.dono.id);
    assert.equal((await prisma.entregaCartao.findUnique({ where: { id: k.id } }))!.dataAlvo!.toISOString(), "2026-12-15T21:00:00.000Z");

    definirModelo(async () => { throw new Error("tempo esgotado"); });
    const b = await registrarFonte({ oportunidadeId: op.id, fonte: "TEXTO", fonteRef: "x2", texto: "texto qualquer com mais de vinte letras" }, { agendar: false });
    await processarAnalise(b!.id);
    assert.deepEqual(await prisma.analiseAgente.findUnique({ where: { id: b!.id }, select: { status: true, erro: true } }), { status: "ERRO", erro: "tempo esgotado" });

    definirModelo(null); // modelo de verdade, mas sem chave configurada
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const c2 = await registrarFonte({ oportunidadeId: op.id, fonte: "TEXTO", fonteRef: "x3", texto: "texto qualquer com mais de vinte letras" }, { agendar: false });
      await processarPendentes(50);
      assert.equal((await prisma.analiseAgente.findUnique({ where: { id: c2!.id } }))!.status, "SEM_CHAVE");
    } finally { if (chave !== undefined) process.env.ANTHROPIC_API_KEY = chave; }
  } finally { await p.limpar(); }
});

test("rotas: listar, criar à mão, aceitar/descartar/entregue, analisar texto e feedback que vira análise", async () => {
  const p = await preparar();
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(p.dono.id, process.env.SESSION_SECRET!)}`;
  const req = (url: string, metodo = "GET", corpo?: unknown, logado = true) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(logado ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  try {
    const op = await p.nova("Rotas");
    assert.equal((await getCombinados(req(`/api/oportunidades/${op.id}/combinados`, "GET", undefined, false), ctx(op.id))).status, 401);
    assert.equal((await postCombinado(req(`/api/oportunidades/${op.id}/combinados`, "POST", { descricao: "ab" }), ctx(op.id))).status, 400);
    const r1 = await postCombinado(req(`/api/oportunidades/${op.id}/combinados`, "POST", { descricao: "Enviar contrato", prazoEm: "2026-12-01" }), ctx(op.id));
    assert.equal(r1.status, 201);
    const criado = await r1.json();

    modeloFalso({ combinados: [item({ descricao: "Agendar kickoff com o dono", tipo: "TAREFA" })] });
    // Feedback escrito pela pessoa vira análise (o agente roda depois; aqui, pela fila).
    assert.equal((await postFeedback(req(`/api/oportunidades/${op.id}/feedbacks`, "POST", { texto: "Liguei: ele topou, combinamos o kickoff para a semana que vem." }), ctx(op.id))).status, 201);
    assert.equal((await postAnalisar(req(`/api/oportunidades/${op.id}/analisar`, "POST", { texto: "curto" }), ctx(op.id))).status, 400);
    assert.equal((await postAnalisar(req(`/api/oportunidades/${op.id}/analisar`, "POST", { texto: "Transcrição: combinamos o kickoff e o envio dos acessos.", fonte: "REUNIAO" }), ctx(op.id))).status, 202);
    await processarPendentes(50);

    const lista = await (await getCombinados(req(`/api/oportunidades/${op.id}/combinados`), ctx(op.id))).json();
    assert.deepEqual(lista.pendentes.map((c: { id: string }) => c.id), [criado.id]);
    assert.equal(lista.sugeridos.length, 1, "duas fontes sugeriram o mesmo kickoff: uma sugestão só");
    assert.deepEqual(lista.analises.map((a: { fonte: string; status: string }) => [a.fonte, a.status]).sort(), [["FEEDBACK", "CONCLUIDA"], ["REUNIAO", "CONCLUIDA"]]);

    const sid = lista.sugeridos[0].id;
    assert.equal((await patchCombinado(req(`/api/combinados/${sid}`, "PATCH", { operacao: "voar" }), ctx(sid))).status, 400);
    const ac = await patchCombinado(req(`/api/combinados/${sid}`, "PATCH", { operacao: "aceitar", prazoEm: "2026-11-24" }), ctx(sid));
    assert.equal(ac.status, 200);
    assert.equal((await ac.json()).prazoEm, "2026-11-24T21:00:00.000Z", "ajuste feito na tela vale na aceitação");
    assert.equal((await patchCombinado(req(`/api/combinados/${criado.id}`, "PATCH", { operacao: "entregue" }), ctx(criado.id))).status, 200);
    assert.equal((await prisma.combinado.findUnique({ where: { id: criado.id } }))!.status, "ENTREGUE");
    assert.equal((await patchCombinado(req(`/api/combinados/nao-existe`, "PATCH", { operacao: "entregue" }), ctx("nao-existe"))).status, 404);
  } finally { await p.limpar(); }
});
