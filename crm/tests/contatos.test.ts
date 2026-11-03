import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { criarTarefa } from "@/lib/atividades/tarefas";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { criarCompromisso } from "@/lib/atividades/compromissos";
import { lerCsv, gerarCsv, detectarSeparador } from "@/lib/contatos/csv";
import { acharDuplicados, atualizarContato, criarContato, detalheContato, ErroDuplicado, excluirContato, exportarCsv, importarCsv, mesclarContatos } from "@/lib/contatos/servico";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getLista, POST as postContato } from "@/app/api/contatos/route";
import { GET as getContato, PATCH as patchContato, DELETE as delContato } from "@/app/api/contatos/[id]/route";
import { POST as postImportar } from "@/app/api/contatos/importar/route";
import { GET as getExportar } from "@/app/api/contatos/exportar/route";
import { POST as postMesclar } from "@/app/api/contatos/mesclar/route";
import { GET as getDuplicados } from "@/app/api/contatos/duplicados/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const tel = () => `5562${Math.floor(1e7 + Math.random() * 9e7)}`; // 12 dígitos: DDI + DDD + número, único por chamada
const limpar = (marca: string) => prisma.contato.deleteMany({ where: { OR: [{ nome: { contains: marca } }, { origem: marca }, { email: { contains: marca } }] } });

test("CSV: separadores, aspas, quebra de linha dentro do campo, BOM, CRLF e linhas vazias", () => {
  assert.equal(detectarSeparador("a;b;c"), ";");
  assert.equal(detectarSeparador("a,b,c"), ",");
  assert.equal(detectarSeparador("a\tb\tc"), "\t");
  assert.equal(detectarSeparador("so-uma-coluna"), ",");
  assert.deepEqual(lerCsv("nome;tel\r\nAna;123\r\n\r\nBia;456\r\n"), [["nome", "tel"], ["Ana", "123"], ["Bia", "456"]]);
  assert.deepEqual(lerCsv('﻿nome,obs\n"Silva, João","disse ""oi""\ne saiu"\nZé,'), [["nome", "obs"], ["Silva, João", 'disse "oi"\ne saiu'], ["Zé", ""]]);
  assert.deepEqual(lerCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(lerCsv(""), []);
  assert.deepEqual(lerCsv("só cabeçalho"), [["só cabeçalho"]]);
  const ida = gerarCsv([["nome", "obs"], ["Silva; João", 'disse "oi"'], ["=HYPERLINK(\"http://x\")", "+55 62"], ["-1", "@usuario"], [null, 7]]);
  assert.ok(ida.startsWith("﻿"));
  assert.deepEqual(lerCsv(ida), [["nome", "obs"], ["Silva; João", 'disse "oi"'], ["'=HYPERLINK(\"http://x\")", "'+55 62"], ["'-1", "'@usuario"], ["", "7"]], "dá a volta, e fórmulas viram texto");
});

test("cadastro: normaliza telefone/e-mail, recusa duplicado e entradas inválidas, vínculo pessoa→empresa", async () => {
  const m = `cad${Date.now()}`;
  try {
    const t = tel();
    const a = await criarContato({ tipo: "PESSOA", nome: `Ana ${m}`, telefone: `(62) ${t.slice(4, 8)}-${t.slice(8)}`, email: ` ANA.${m}@Teste.COM `, origem: m });
    assert.deepEqual([a.telefone, a.email, a.cicloDeVida], [t, `ana.${m}@teste.com`, "LEAD"], "telefone formatado vira só dígitos com DDI; e-mail em minúsculas");
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: `Outra ${m}`, telefone: a.telefone, origem: m }), (e: unknown) => e instanceof ErroDuplicado && e.existenteId === a.id && /telefone/.test(e.message));
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: `Outra ${m}`, email: `ANA.${m}@TESTE.com`, origem: m }), (e: unknown) => e instanceof ErroDuplicado && /e-mail/.test(e.message), "e-mail sem diferenciar caixa");
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: "x", telefone: "123" }), /Telefone inválido/);
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: "x", email: "sem-arroba" }), /E-mail inválido/);
    await assert.rejects(criarContato({ tipo: "ROBO", nome: "x" }), /tipo inválido/);

    const emp = await criarContato({ tipo: "EMPRESA", nome: `Oficina ${m}`, origem: m });
    const pes = await criarContato({ tipo: "PESSOA", nome: `Dono ${m}`, empresaId: emp.id, origem: m });
    assert.equal(pes.empresaId, emp.id);
    await assert.rejects(criarContato({ tipo: "EMPRESA", nome: `Filial ${m}`, empresaId: emp.id }), /Só uma pessoa/);
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: "x", empresaId: pes.id }), /Empresa não encontrada/, "vínculo precisa ser com empresa");
    await assert.rejects(criarContato({ tipo: "PESSOA", nome: "x", empresaId: "nao-existe" }), /Empresa não encontrada/);

    // atualizar: ignora o próprio registro na checagem; recusa telefone de outro; limpa campo; ciclo e vínculo validados
    assert.equal((await atualizarContato(a.id, { telefone: a.telefone, nome: `Ana Maria ${m}` }))!.nome, `Ana Maria ${m}`);
    await assert.rejects(atualizarContato(pes.id, { telefone: a.telefone }), ErroDuplicado);
    assert.equal((await atualizarContato(a.id, { email: null }))!.email, null);
    await assert.rejects(atualizarContato(a.id, { cicloDeVida: "VIP" }), /ciclo de vida inválido/);
    await assert.rejects(atualizarContato(pes.id, { empresaId: pes.id }), /si mesmo/);
    assert.equal((await atualizarContato(pes.id, { empresaId: null }))!.empresaId, null);
    assert.equal(await atualizarContato("nao-existe", { nome: "x" }), null);

    // excluir: bloqueado com oportunidade; livre sem
    const c = await cenario();
    try {
      const op = await criarOportunidade({ nome: "Opp", contatoId: emp.id, funilId: c.funil.id });
      await assert.rejects(excluirContato(emp.id), /tem oportunidades ou entregas/);
      await prisma.oportunidade.delete({ where: { id: op.id } });
      assert.equal(await excluirContato(emp.id), true);
      assert.equal(await excluirContato(emp.id), false);
    } finally { await c.limpar(); }
  } finally { await limpar(m); }
});

test("importação: cabeçalhos em português, simulação não grava, duplicados, inválidos, empresa criada e reaproveitada", async () => {
  const m = `imp${Date.now()}`;
  const [t1, t2, t3] = [tel(), tel(), tel()];
  const existente = await criarContato({ tipo: "PESSOA", nome: `Já existe ${m}`, telefone: t3, origem: m });
  try {
    const csv = [
      "Nome;Celular;E-mail;Empresa;Segmento;Cargo;CNPJ;Origem;Ciclo de vida;Coluna Extra",
      `Ana ${m};${t1.slice(2)};ana.${m}@x.com;Padaria ${m};Alimentação;Dona;12.345.678/0001-90;${m};cliente;lixo`,
      `Bia ${m};(62) ${t2.slice(4, 9)}-${t2.slice(9)};;padaria ${m.toUpperCase()};;;;${m};;`, // mesma empresa, caixa diferente
      `Cássio ${m};${t3};;;;;;${m};;`, // telefone já cadastrado
      `Ana de novo ${m};${t1};;;;;;${m};;`, // repetida dentro do arquivo
      `;1199999999;;;;;;${m};;`, // sem nome
      `Dani ${m};12;dani-invalido;;;;;${m};;`, // telefone e e-mail inválidos: contato entra sem eles
      `Eva ${m};;eva.${m}@x.com;;;;;${m};;`,
    ].join("\n");
    const sim = await importarCsv(csv, { simular: true, responsavelId: null });
    assert.deepEqual([sim.total, sim.criados, sim.duplicados, sim.invalidos, sim.camposIgnorados, sim.simulacao], [7, 4, 2, 1, 2, true]);
    assert.deepEqual(sim.colunasReconhecidas.sort(), ["ciclo", "documento", "email", "empresa", "nome", "origem", "segmento", "cargo", "telefone"].sort());
    assert.deepEqual(sim.colunasIgnoradas, ["Coluna Extra"]);
    assert.ok(sim.problemas.some((p) => p.linha === 6 && /Sem nome/.test(p.motivo)), "linha do arquivo (com cabeçalho = 1)");
    assert.equal(await prisma.contato.count({ where: { origem: m } }), 1, "simular não gravou nada (só o existente)");

    const real = await importarCsv(csv, { simular: false, responsavelId: null });
    assert.deepEqual([real.criados, real.duplicados, real.invalidos, real.simulacao], [4, 2, 1, false]);
    const ana = (await prisma.contato.findFirst({ where: { nome: `Ana ${m}` }, include: { empresa: true } }))!;
    assert.deepEqual([ana.tipo, ana.telefone, ana.email, ana.cargo, ana.documento, ana.cicloDeVida, ana.empresa?.nome, ana.empresa?.tipo], ["PESSOA", `55${t1.slice(2)}`, `ana.${m}@x.com`, "Dona", "12.345.678/0001-90", "CLIENTE", `Padaria ${m}`, "EMPRESA"]);
    const bia = (await prisma.contato.findFirst({ where: { nome: `Bia ${m}` } }))!;
    assert.equal(bia.empresaId, ana.empresaId, "empresa reaproveitada sem diferenciar caixa");
    assert.equal(await prisma.contato.count({ where: { tipo: "EMPRESA", nome: { equals: `Padaria ${m}`, mode: "insensitive" } } }), 1);
    const dani = (await prisma.contato.findFirst({ where: { nome: `Dani ${m}` } }))!;
    assert.deepEqual([dani.telefone, dani.email], [null, null]);
    assert.equal(await prisma.contato.count({ where: { nome: { startsWith: "Cássio" }, origem: m } }), 0);

    // reimportar o mesmo arquivo: tudo vira duplicado
    const de_novo = await importarCsv(csv, { simular: false, responsavelId: null });
    assert.equal(de_novo.criados, 1, "só a Dani (sem telefone nem e-mail) não tem como ser reconhecida como repetida");
    assert.equal(de_novo.duplicados, 5);
  } finally { await limpar(m); await prisma.contato.delete({ where: { id: existente.id } }).catch(() => {}); }
});

test("importação: limites e arquivos ruins", async () => {
  const falha = (csv: string, re: RegExp) => assert.rejects(importarCsv(csv, { simular: true, responsavelId: null }), re);
  await falha("", /cabeçalho e ao menos uma linha/);
  await falha("nome", /cabeçalho e ao menos uma linha/);
  await falha("telefone;email\n6299999999;a@b.com", /coluna de nome/);
  await falha("nome\n" + Array.from({ length: 5001 }, (_, i) => `n${i}`).join("\n"), /Máximo de 5000 linhas/);
  await falha("nome\n" + "x".repeat(2_000_001), /grande demais/);
  const ok = await importarCsv("nome\n" + Array.from({ length: 5000 }, (_, i) => `n${i}`).join("\n"), { simular: true, responsavelId: null });
  assert.equal(ok.total, 5000, "exatamente no limite passa");
});

test("exportação: dá a volta com a importação e neutraliza fórmulas", async () => {
  const m = `exp${Date.now()}`;
  try {
    const a = await criarContato({ tipo: "EMPRESA", nome: `=CMD("calc") ${m}`, telefone: tel(), origem: m, segmento: "Autopeças; peças" });
    const csv = await exportarCsv();
    assert.ok(csv.includes(`'=CMD(""calc"") ${m}`), "fórmula vira texto");
    assert.ok(!/(^|;|\r\n)=CMD/.test(csv), "nenhuma célula começa com =");
    const linhas = lerCsv(csv);
    const l = linhas.find((x) => x[0].includes(m))!;
    assert.deepEqual([linhas[0][0], l[1], l[5]], ["nome", "Empresa", "Autopeças; peças"]);
    assert.ok(a.id);
  } finally { await limpar(m); }
});

test("duplicados e mesclagem: acha por telefone, e-mail e nome; mescla com todas as relações", async () => {
  const m = `mes${Date.now()}`;
  const c = await cenario(true);
  const mk = (nome: string, extra: Record<string, unknown> = {}) => prisma.contato.create({ data: { tipo: "PESSOA", nome: `${nome} ${m}`, origem: m, ...extra } });
  try {
    const t = tel();
    const dest = await mk("João", { telefone: null, email: `joao.${m}@x.com`, cicloDeVida: "LEAD" });
    const orig = await mk("Joao", { telefone: t, email: `JOAO.${m}@x.com`.toLowerCase(), segmento: "Autopeças", cargo: "Dono", cicloDeVida: "CLIENTE", vendedorIaLeadId: `lead-${m}` });
    const grupos = (await acharDuplicados()).filter((g) => g.contatos.some((x) => [dest.id, orig.id].includes(x.id)));
    assert.deepEqual(grupos.map((g) => [g.motivo, g.contatos.length]), [["email", 2]]);
    const clone = await mk("João", {}); // mesmo nome do destino
    assert.ok((await acharDuplicados()).some((g) => g.motivo === "nome" && g.contatos.some((x) => x.id === clone.id) && g.contatos.some((x) => x.id === dest.id)));
    await prisma.contato.delete({ where: { id: clone.id } });

    // tudo que apontava para a origem
    const emp = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: `Emp ${m}`, origem: m } });
    const op = await criarOportunidade({ nome: "Do origem", contatoId: orig.id, funilId: c.funil.id });
    const op2 = await criarOportunidade({ nome: "Pessoa relacionada", contatoId: emp.id, pessoaId: orig.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" }); // abre entrega ligada ao contato
    await criarTarefa({ titulo: "t", contatoId: orig.id });
    await registrarFeedback({ contatoId: orig.id, tipo: "NOTA", texto: "n" });
    await criarCompromisso({ assunto: "r", inicio: new Date(Date.now() + 1e6), fim: new Date(Date.now() + 2e6), contatoId: orig.id });
    const filha = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Funcionario ${m}`, origem: m, empresaId: orig.id } });
    // (origem é pessoa; o vínculo empresa→pessoas é testado abaixo com duas empresas)

    const movidos = await mesclarContatos(orig.id, dest.id);
    assert.deepEqual([movidos.oportunidades, movidos.comoPessoa, movidos.tarefas, movidos.feedbacks, movidos.compromissos, movidos.entregas, movidos.pessoas], [1, 1, 1, 1, 1, 1, 1]);
    assert.equal(await prisma.contato.findUnique({ where: { id: orig.id } }), null, "origem deixa de existir");
    const d = (await prisma.contato.findUnique({ where: { id: dest.id } }))!;
    assert.deepEqual([d.telefone, d.segmento, d.cargo, d.cicloDeVida, d.vendedorIaLeadId, d.email], [t, "Autopeças", "Dono", "CLIENTE", `lead-${m}`, `joao.${m}@x.com`], "campos vazios preenchidos; ciclo mais avançado vence; vínculo do Vendedor IA passa");
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.contatoId, dest.id);
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: op2.id } }))!.pessoaId, dest.id);
    assert.equal((await prisma.contato.findUnique({ where: { id: filha.id } }))!.empresaId, dest.id);
    const det = (await detalheContato(dest.id))!;
    assert.deepEqual([det.oportunidades.length, det.tarefas.length, det.feedbacks.length, det.entregas.length, det.pessoas.length], [1, 1, 1, 1, 1]);

    // regras
    await assert.rejects(mesclarContatos(dest.id, dest.id), /dois contatos diferentes/);
    await assert.rejects(mesclarContatos(dest.id, "nao-existe"), /não encontrado/);
    await assert.rejects(mesclarContatos(dest.id, emp.id), /empresa com empresa ou pessoa com pessoa/);
    const empresaA = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: `A ${m}`, origem: m } });
    const filhaDeA = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Filha ${m}`, origem: m, empresaId: empresaA.id } });
    await assert.rejects(mesclarContatos(empresaA.id, filhaDeA.id), /empresa com empresa/);
    const empresaB = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: `B ${m}`, origem: m } });
    await mesclarContatos(empresaA.id, empresaB.id);
    assert.equal((await prisma.contato.findUnique({ where: { id: filhaDeA.id } }))!.empresaId, empresaB.id, "funcionários passam para a empresa que ficou");
  } finally { await prisma.entrega.deleteMany({ where: { oportunidade: { funilId: c.funil.id } } }); await prisma.oportunidade.deleteMany({ where: { funilId: c.funil.id } }); await limpar(m); await c.limpar(); }
});

test("rotas de contatos: sessão, 409 com existenteId, importação, exportação só de administrador, mesclagem", async () => {
  const m = `rot${Date.now()}`;
  const admin = await prisma.usuario.create({ data: { nome: `Adm ${m}`, email: `adm${m}@t.local`, papel: "ADMIN", senhaHash: "x" } });
  const vend = await prisma.usuario.create({ data: { nome: `Ven ${m}`, email: `ven${m}@t.local`, papel: "VENDEDOR", senhaHash: "x" } });
  const ck = async (u: { id: string }) => `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const [ca, cv] = [await ck(admin), await ck(vend)];
  const req = (cookie: string | null, url: string, metodo = "GET", corpo?: unknown) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const p = (id: string) => ({ params: Promise.resolve({ id }) });
  try {
    assert.equal((await getLista(req(null, "/x"))).status, 401);
    assert.equal((await postContato(req(null, "/x", "POST", { nome: "x" }))).status, 401);
    assert.equal((await postContato(req(cv, "/x", "POST", { nome: " " }))).status, 400);
    assert.equal((await postContato(req(cv, "/x", "POST", { nome: "x", tipo: "ROBO" }))).status, 400);
    const t = tel();
    const ok = await postContato(req(cv, "/x", "POST", { nome: `Rota ${m}`, telefone: t, origem: m }));
    assert.equal(ok.status, 201);
    const id = (await ok.json()).id;
    const dup = await postContato(req(cv, "/x", "POST", { nome: `Outra ${m}`, telefone: t }));
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).existenteId, id);
    assert.equal((await getContato(req(cv, "/x"), p(id))).status, 200);
    assert.equal((await getContato(req(cv, "/x"), p("nao-existe"))).status, 404);
    assert.equal((await patchContato(req(cv, "/x", "PATCH", { cicloDeVida: "VIP" }), p(id))).status, 400);
    assert.equal((await patchContato(req(cv, "/x", "PATCH", { cicloDeVida: "CLIENTE", cargo: "Dono" }), p(id))).status, 200);
    assert.equal((await prisma.contato.findUnique({ where: { id: id } }))!.cicloDeVida, "CLIENTE");
    assert.equal((await getLista(req(cv, `/api/contatos?ciclo=CLIENTE&q=${m}`)).then((r) => r.json())).total, 1);
    assert.equal((await getLista(req(cv, `/api/contatos?ciclo=LEAD&q=${m}`)).then((r) => r.json())).total, 0);

    // importação
    assert.equal((await postImportar(req(null, "/x", "POST", { csv: "nome\nx" }))).status, 401);
    assert.equal((await postImportar(req(cv, "/x", "POST", { csv: 5 }))).status, 400);
    assert.equal((await postImportar(req(cv, "/x", "POST", { csv: "telefone\n123" }))).status, 400);
    const sim = await (await postImportar(req(cv, "/x", "POST", { csv: `nome;origem\nImp ${m};${m}` }))).json();
    assert.deepEqual([sim.simulacao, sim.criados], [true, 1], "simulação é o padrão");
    assert.equal(await prisma.contato.count({ where: { nome: `Imp ${m}` } }), 0);
    await postImportar(req(cv, "/x", "POST", { csv: `nome;origem\nImp ${m};${m}`, simular: false }));
    assert.equal(await prisma.contato.count({ where: { nome: `Imp ${m}` } }), 1);

    // exportação: só administrador
    assert.equal((await getExportar(req(null, "/x"))).status, 401);
    assert.equal((await getExportar(req(cv, "/x"))).status, 403);
    const exp = await getExportar(req(ca, "/x"));
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get("content-type")!, /text\/csv/);
    assert.match(exp.headers.get("content-disposition")!, /attachment; filename="contatos-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.ok((await exp.text()).includes(`Rota ${m}`));

    // mesclar / duplicados / excluir
    const outro = await postContato(req(cv, "/x", "POST", { nome: `Outro ${m}`, origem: m }));
    const outroId = (await outro.json()).id;
    assert.equal((await postMesclar(req(null, "/x", "POST", { origemId: id, destinoId: outroId }))).status, 401);
    assert.equal((await postMesclar(req(cv, "/x", "POST", { origemId: id }))).status, 400);
    assert.equal((await postMesclar(req(cv, "/x", "POST", { origemId: id, destinoId: id }))).status, 400);
    assert.equal((await getDuplicados(req(cv, "/x"))).status, 200);
    assert.equal((await postMesclar(req(cv, "/x", "POST", { origemId: id, destinoId: outroId }))).status, 200);
    assert.equal((await delContato(req(cv, "/x", "DELETE"), p(id))).status, 404, "a origem foi absorvida");
    assert.equal((await delContato(req(cv, "/x", "DELETE"), p(outroId))).status, 200);
  } finally { await limpar(m); await prisma.usuario.deleteMany({ where: { id: { in: [admin.id, vend.id] } } }); }
});
