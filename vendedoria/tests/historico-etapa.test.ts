// Histórico de etapa do funil: a regra "só src/lib/crm/historico-etapa.ts troca a
// coluna de um lead" (primeiro teste, sem banco) e o comportamento do módulo
// (demais testes, com banco real — pulados sem DATABASE_URL).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const temBanco = Boolean(process.env.DATABASE_URL);
const SRC = path.join(process.cwd(), "src");
const MODULO_CENTRAL = path.join("src", "lib", "crm", "historico-etapa.ts");

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** Chamadas `<algo>.lead.<metodo>(...)` cujo `data` contém kanbanColumnId / kanbanColumn. */
function escritasDeColuna(arquivo: string): Array<{ metodo: string; linha: number }> {
  const fonte = fs.readFileSync(arquivo, "utf8");
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true);
  const achados: Array<{ metodo: string; linha: number }> = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const metodo = n.expression.name.text;
      const alvo = n.expression.expression;
      const ehLead = ts.isPropertyAccessExpression(alvo) && alvo.name.text === "lead";
      if (ehLead && ["update", "updateMany", "upsert", "create", "createMany"].includes(metodo)) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            const nome = prop.name && (ts.isIdentifier(prop.name) ? prop.name.text : "");
            if (!["data", "create", "update"].includes(nome ?? "")) continue;
            const texto = (prop as ts.PropertyAssignment).initializer?.getText(sf) ?? "";
            if (/\bkanbanColumn(Id)?\b/.test(texto)) {
              achados.push({ metodo, linha: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
            }
          }
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return achados;
}

test("só historico-etapa.ts troca a coluna de um lead existente; toda criação registra o histórico", () => {
  const violacoes: string[] = [];
  for (const arq of arquivos(SRC)) {
    const rel = path.relative(process.cwd(), arq);
    if (rel === MODULO_CENTRAL) continue;
    const fonte = fs.readFileSync(arq, "utf8");
    for (const w of escritasDeColuna(arq)) {
      if (w.metodo === "create") {
        if (!fonte.includes("registrarCriacaoLead")) {
          violacoes.push(`${rel}:${w.linha} cria lead com coluna mas não chama registrarCriacaoLead`);
        }
      } else {
        violacoes.push(`${rel}:${w.linha} lead.${w.metodo}() grava a coluna direto — use aplicarMudancaDeEtapa`);
      }
    }
  }
  assert.deepEqual(violacoes, []);
});

async function cenario() {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `h${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const outraOrg = await prisma.whatsappBusinessOrganization.create({ data: { name: marca + "x", documentId: "2", documentType: "CNPJ" } });
  const mkCol = (name: string, type: string, order: number, entry = false) =>
    prisma.kanbanColumn.create({ data: { name, type, order, color: "#000", organizationId: org.id, isDefaultEntry: entry } });
  const novos = await mkCol("Novos", "TRIAGE", 0, true);
  const qualif = await mkCol("Qualificação", "EM_QUALIFICACAO", 1);
  const ganho = await mkCol("Ganho", "GANHO", 2);
  const perdido = await mkCol("Perdido", "LOST", 3);
  const mkLead = (col = novos) =>
    prisma.lead.create({ data: { phoneNumber: `55${Math.floor(Math.random() * 1e9)}`, leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const historico = (leadId: string) =>
    prisma.leadStageHistory.findMany({ where: { leadId }, orderBy: [{ enteredAt: "asc" }, { id: "asc" }] });
  const limpar = async () => {
    const leads = await prisma.lead.findMany({ where: { organizationId: { in: [org.id, outraOrg.id] } }, select: { id: true } });
    const ids = leads.map((l) => l.id);
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } }); // histórico cai em cascata
    await prisma.motivoEncerramento.deleteMany({ where: { organizationId: { in: [org.id, outraOrg.id] } } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.deleteMany({ where: { id: { in: [org.id, outraOrg.id] } } });
  };
  return { prisma, org, outraOrg, novos, qualif, ganho, perdido, mkLead, historico, mkCol, limpar };
}

test("criação abre uma linha de histórico (e só uma, mesmo chamada duas vezes)", { skip: !temBanco }, async () => {
  const c = await cenario();
  const { registrarCriacaoLead } = await import("@/lib/crm/historico-etapa");
  try {
    const lead = await c.mkLead();
    await registrarCriacaoLead({ leadId: lead.id, coluna: c.novos });
    await registrarCriacaoLead({ leadId: lead.id, coluna: c.novos });
    const h = await c.historico(lead.id);
    assert.equal(h.length, 1);
    assert.equal(h[0].toName, "Novos");
    assert.equal(h[0].exitedAt, null);
    assert.equal(h[0].origem, "CRIACAO");
    assert.equal(h[0].enteredAt.getTime(), lead.etapaDesdeEm.getTime());

    const jaGanho = await c.mkLead(c.ganho);
    await registrarCriacaoLead({ leadId: jaGanho.id, coluna: c.ganho });
    assert.ok((await c.prisma.lead.findUnique({ where: { id: jaGanho.id } }))!.encerradoEm, "criado direto em Ganho já nasce encerrado");
  } finally { await c.limpar(); }
});

test("mover fecha a etapa anterior, abre a nova e reinicia o relógio", { skip: !temBanco }, async () => {
  const c = await cenario();
  const { registrarCriacaoLead, aplicarMudancaDeEtapa } = await import("@/lib/crm/historico-etapa");
  try {
    const lead = await c.mkLead();
    await registrarCriacaoLead({ leadId: lead.id, coluna: c.novos });
    const t1 = new Date(Date.now() + 60_000);
    const r = await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.qualif, origem: "PIPELINE", ator: "sistema", motivo: "teste", quando: t1, dadosLead: { lastActivityAt: t1 } });
    assert.equal(r.mudou, true);
    assert.equal(r.de?.name, "Novos");

    const h = await c.historico(lead.id);
    assert.equal(h.length, 2);
    assert.equal(h[0].exitedAt?.getTime(), t1.getTime(), "etapa anterior fechada no instante da troca");
    assert.equal(h[1].fromName, "Novos");
    assert.equal(h[1].toName, "Qualificação");
    assert.equal(h[1].exitedAt, null);
    assert.equal(h[1].ator, "sistema");
    assert.equal(h[1].motivo, "teste");

    const depois = (await c.prisma.lead.findUnique({ where: { id: lead.id } }))!;
    assert.equal(depois.kanbanColumnId, c.qualif.id);
    assert.equal(depois.etapaDesdeEm.getTime(), t1.getTime());
    assert.equal(depois.encerradoEm, null);

    // já está na coluna: não cria linha, mas aplica os dados extras
    const t2 = new Date(Date.now() + 120_000);
    const igual = await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.qualif, origem: "PIPELINE", dadosLead: { lastActivityAt: t2 } });
    assert.equal(igual.mudou, false);
    assert.equal((await c.historico(lead.id)).length, 2);
    assert.equal((await c.prisma.lead.findUnique({ where: { id: lead.id } }))!.lastActivityAt?.getTime(), t2.getTime());
  } finally { await c.limpar(); }
});

test("lead sem linha aberta ganha uma linha de reconstrução ao mudar de etapa", { skip: !temBanco }, async () => {
  const c = await cenario();
  const { aplicarMudancaDeEtapa } = await import("@/lib/crm/historico-etapa");
  try {
    const lead = await c.mkLead(); // criado "por um caminho esquecido": sem histórico
    assert.equal((await c.historico(lead.id)).length, 0);
    await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.qualif, origem: "MANUAL" });
    const h = await c.historico(lead.id);
    assert.deepEqual(h.map((x) => [x.toName, x.origem, x.exitedAt !== null]), [["Novos", "BACKFILL", true], ["Qualificação", "MANUAL", false]]);
    assert.equal(h[0].enteredAt.getTime(), lead.etapaDesdeEm.getTime(), "tempo na etapa antiga preservado");
  } finally { await c.limpar(); }
});

test("ganho/perda: motivo do catálogo, validação e limpeza ao reabrir", { skip: !temBanco }, async () => {
  const c = await cenario();
  const { aplicarMudancaDeEtapa } = await import("@/lib/crm/historico-etapa");
  const { listarMotivos, motivoIdPorNome, MOTIVO } = await import("@/lib/crm/motivos");
  try {
    const motivos = await listarMotivos(c.org.id);
    assert.ok(motivos.length >= 10);
    assert.equal((await listarMotivos(c.org.id)).length, motivos.length, "catálogo padrão é idempotente");
    const perda = motivos.find((m) => m.tipo === "PERDA" && m.nome === "Preço")!;
    const venda = motivos.find((m) => m.tipo === "GANHO")!;
    const doutraOrg = (await listarMotivos(c.outraOrg.id)).find((m) => m.tipo === "PERDA")!;

    const lead = await c.mkLead();
    await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.perdido, origem: "MANUAL", motivoEncerramentoId: perda.id, motivoDetalhe: "  achou caro  " });
    let l = (await c.prisma.lead.findUnique({ where: { id: lead.id }, include: { motivoEncerramento: true } }))!;
    assert.equal(l.motivoEncerramento?.nome, "Preço");
    assert.equal(l.motivoDetalhe, "achou caro");
    assert.ok(l.encerradoEm);

    // perda → ganho: o motivo de perda não vale mais
    await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.ganho, origem: "MANUAL" });
    l = (await c.prisma.lead.findUnique({ where: { id: lead.id }, include: { motivoEncerramento: true } }))!;
    assert.equal(l.motivoEncerramentoId, null);
    assert.equal(l.motivoDetalhe, null);

    // motivo de perda numa coluna de ganho: ignorado
    const b = await c.mkLead();
    await aplicarMudancaDeEtapa({ leadId: b.id, coluna: c.ganho, origem: "MANUAL", motivoEncerramentoId: perda.id });
    assert.equal((await c.prisma.lead.findUnique({ where: { id: b.id } }))!.motivoEncerramentoId, null);
    // motivo de outra organização: ignorado
    const d = await c.mkLead();
    await aplicarMudancaDeEtapa({ leadId: d.id, coluna: c.perdido, origem: "MANUAL", motivoEncerramentoId: doutraOrg.id });
    assert.equal((await c.prisma.lead.findUnique({ where: { id: d.id } }))!.motivoEncerramentoId, null);
    // motivo desativado: ignorado
    await c.prisma.motivoEncerramento.update({ where: { id: venda.id }, data: { ativo: false } });
    const e = await c.mkLead();
    await aplicarMudancaDeEtapa({ leadId: e.id, coluna: c.ganho, origem: "MANUAL", motivoEncerramentoId: venda.id });
    assert.equal((await c.prisma.lead.findUnique({ where: { id: e.id } }))!.motivoEncerramentoId, null);
    assert.equal(await motivoIdPorNome(c.org.id, "GANHO", venda.nome), null);

    // reabrir limpa encerramento
    await aplicarMudancaDeEtapa({ leadId: lead.id, coluna: c.qualif, origem: "MANUAL" });
    l = (await c.prisma.lead.findUnique({ where: { id: lead.id }, include: { motivoEncerramento: true } }))!;
    assert.equal(l.encerradoEm, null);

    assert.ok(await motivoIdPorNome(c.org.id, "PERDA", MOTIVO.FORA_ICP));
  } finally { await c.limpar(); }
});

test("lote: move só quem não está na coluna, com histórico e motivo coerente", { skip: !temBanco }, async () => {
  const c = await cenario();
  const { aplicarMudancaDeEtapa, aplicarMudancaDeEtapaEmLote, registrarCriacaoLead } = await import("@/lib/crm/historico-etapa");
  const { listarMotivos } = await import("@/lib/crm/motivos");
  try {
    const perda = (await listarMotivos(c.org.id)).find((m) => m.tipo === "PERDA")!;
    const a = await c.mkLead();
    const b = await c.mkLead();
    const jaLa = await c.mkLead(c.qualif);
    const perdido = await c.mkLead();
    await registrarCriacaoLead({ leadId: a.id, coluna: c.novos });
    // b e perdido: sem linha aberta (reconstrução); perdido está encerrado com motivo
    await aplicarMudancaDeEtapa({ leadId: perdido.id, coluna: c.perdido, origem: "MANUAL", motivoEncerramentoId: perda.id });

    const n = await aplicarMudancaDeEtapaEmLote({ leadIds: [a.id, b.id, jaLa.id, perdido.id], coluna: c.qualif, origem: "SINCRONIZACAO", ator: "ADMIN" });
    assert.equal(n, 3, "jaLa já estava na coluna");

    for (const l of [a, b, perdido]) {
      const dep = (await c.prisma.lead.findUnique({ where: { id: l.id } }))!;
      assert.equal(dep.kanbanColumnId, c.qualif.id);
      assert.equal(dep.encerradoEm, null);
      const h = await c.historico(l.id);
      const abertas = h.filter((x) => x.exitedAt === null);
      assert.equal(abertas.length, 1, "uma única etapa aberta");
      assert.equal(abertas[0].origem, "SINCRONIZACAO");
      assert.equal(abertas[0].toName, "Qualificação");
    }
    assert.equal((await c.prisma.lead.findUnique({ where: { id: perdido.id } }))!.motivoEncerramentoId, null, "saiu de perda: motivo some");
    assert.equal((await c.historico(jaLa.id)).length, 0, "quem já estava na coluna não ganha linha");
    assert.equal(await aplicarMudancaDeEtapaEmLote({ leadIds: [], coluna: c.qualif, origem: "SINCRONIZACAO" }), 0);
  } finally { await c.limpar(); }
});

test("moverLeadPorTipo grava motivo por nome; consolidar colunas legadas preserva o relógio", { skip: !temBanco }, async () => {
  process.env.META_CAPI_DRY_RUN = "true";
  const c = await cenario();
  const { moverLeadPorTipo, consolidarColunasEm5Etapas } = await import("@/lib/crm/pipeline-mover");
  const { registrarCriacaoLead, aplicarMudancaDeEtapa } = await import("@/lib/crm/historico-etapa");
  const { MOTIVO } = await import("@/lib/crm/motivos");
  try {
    const a = await c.mkLead();
    await registrarCriacaoLead({ leadId: a.id, coluna: c.novos });
    assert.equal(await moverLeadPorTipo(a.id, c.org.id, "LOST", "Lead fora do ICP", undefined, { motivoEncerramento: MOTIVO.FORA_ICP, ator: "AI_AGENT", origem: "IA" }), true);
    const l = (await c.prisma.lead.findUnique({ where: { id: a.id }, include: { motivoEncerramento: true } }))!;
    assert.equal(l.motivoEncerramento?.nome, MOTIVO.FORA_ICP);
    const ultima = (await c.historico(a.id)).at(-1)!;
    assert.deepEqual([ultima.toType, ultima.origem, ultima.ator], ["LOST", "IA", "AI_AGENT"]);
    assert.equal(await moverLeadPorTipo(a.id, c.org.id, "LOST"), false, "idempotente");

    // layout legado: a coluna "1º Contato" (CONTATO_1) é fundida em "Novos" (TRIAGE)
    const legada = await c.mkCol("1º Contato", "CONTATO_1", 9);
    const b = await c.mkLead(legada);
    await registrarCriacaoLead({ leadId: b.id, coluna: legada });
    const antes = (await c.prisma.lead.findUnique({ where: { id: b.id } }))!.etapaDesdeEm;
    await consolidarColunasEm5Etapas(c.org.id);
    const dep = (await c.prisma.lead.findUnique({ where: { id: b.id }, include: { kanbanColumn: true } }))!;
    assert.equal(dep.kanbanColumnId, c.novos.id);
    assert.equal(dep.etapaDesdeEm.getTime(), antes.getTime(), "fusão não reinicia o relógio");
    const h = await c.historico(b.id);
    assert.equal(h.length, 1);
    assert.equal(h[0].toColumnId, dep.kanbanColumnId);
    assert.equal(h[0].exitedAt, null);
    // e o lead continua se movendo normalmente depois da fusão
    await aplicarMudancaDeEtapa({ leadId: b.id, coluna: c.ganho, origem: "MANUAL" });
    assert.equal((await c.historico(b.id)).length, 2);
  } finally {
    await c.limpar();
  }
});

test("GraphQL: motivos, mover com motivo, quadro, criação e recusa de coluna de outra organização", { skip: !temBanco }, async () => {
  process.env.META_CAPI_DRY_RUN = "true";
  const c = await cenario();
  const { ApolloServer } = await import("@apollo/server");
  const { typeDefs } = await import("@/graphql/schema/typeDefs");
  const { resolvers } = await import("@/graphql/resolvers");
  const server = new ApolloServer({ typeDefs, resolvers });
  const ctx = { userId: "u1", allowedOrgIds: [c.org.id, c.outraOrg.id] };
  const rodar = async (query: string, variables: Record<string, unknown>, contextValue: { userId?: string; allowedOrgIds: string[] } = ctx) => {
    const r = await server.executeOperation({ query, variables }, { contextValue });
    assert.equal(r.body.kind, "single");
    return (r.body as { singleResult: { data?: Record<string, any>; errors?: Array<{ message: string }> } }).singleResult;
  };
  try {
    // motivos
    const m = await rodar(`query($o:String!,$t:String){ motivosEncerramento(organizationId:$o,tipo:$t){ id nome tipo } }`, { o: c.org.id, t: "PERDA" });
    assert.equal(m.errors, undefined);
    const lista = m.data!.motivosEncerramento as Array<{ id: string; nome: string; tipo: string }>;
    assert.ok(lista.length >= 8 && lista.every((x) => x.tipo === "PERDA"));
    const preco = lista.find((x) => x.nome === "Preço")!;

    // criação pela API
    const cr = await rodar(
      `mutation($i:CreateLeadInput!){ createLead(input:$i){ id } }`,
      { i: { phoneNumber: "62984465388", leadOrigin: "INBOUND", organizationId: c.org.id, kanbanColumnId: c.novos.id } },
    );
    assert.equal(cr.errors, undefined);
    const leadId = cr.data!.createLead.id as string;
    const h0 = await c.historico(leadId);
    assert.deepEqual(h0.map((x) => [x.toName, x.origem, x.ator]), [["Novos", "MANUAL", "u1"]]);

    // mover para Perdido com motivo
    const mv = await rodar(
      `mutation($l:String!,$c:String!,$m:String,$d:String){ updateLeadKanbanColumn(leadId:$l,columnId:$c,motivoEncerramentoId:$m,motivoDetalhe:$d){ id kanbanColumnId kanbanColumn{ type } } }`,
      { l: leadId, c: c.perdido.id, m: preco.id, d: "achou caro" },
    );
    assert.equal(mv.errors, undefined);
    assert.equal(mv.data!.updateLeadKanbanColumn.kanbanColumn.type, "LOST");
    const h1 = await c.historico(leadId);
    assert.equal(h1.length, 2);
    assert.deepEqual([h1[1].toName, h1[1].origem, h1[1].ator], ["Perdido", "MANUAL", "u1"]);

    // quadro devolve tempo na etapa e motivo
    const q = await rodar(
      `query($o:String!){ getKanbanBoard(organizationId:$o){ columns{ name leads{ id etapaDesdeEm encerradoEm motivoDetalhe motivoEncerramento{ nome tipo } } } } }`,
      { o: c.org.id },
    );
    assert.equal(q.errors, undefined);
    const cardPerdido = (q.data!.getKanbanBoard.columns as Array<{ name: string; leads: any[] }>).find((x) => x.name === "Perdido")!.leads.find((l) => l.id === leadId);
    assert.equal(cardPerdido.motivoEncerramento.nome, "Preço");
    assert.equal(cardPerdido.motivoDetalhe, "achou caro");
    assert.ok(cardPerdido.etapaDesdeEm && cardPerdido.encerradoEm);

    // coluna de outra organização é recusada e nada muda
    const colOutra = await c.prisma.kanbanColumn.create({ data: { name: "Alheia", type: "CUSTOM", order: 0, color: "#000", organizationId: c.outraOrg.id } });
    const ruim = await rodar(`mutation($l:String!,$c:String!){ updateLeadKanbanColumn(leadId:$l,columnId:$c){ id } }`, { l: leadId, c: colOutra.id });
    assert.match(ruim.errors?.[0]?.message ?? "", /Coluna não encontrada/);
    assert.equal((await c.prisma.lead.findUnique({ where: { id: leadId } }))!.kanbanColumnId, c.perdido.id);
    assert.equal((await c.historico(leadId)).length, 2);

    // sem login
    const semLogin = await rodar(`query($o:String!){ motivosEncerramento(organizationId:$o){ id } }`, { o: c.org.id }, { allowedOrgIds: [] });
    assert.match(semLogin.errors?.[0]?.message ?? "", /Não autenticado/);
  } finally { await c.limpar(); }
});
