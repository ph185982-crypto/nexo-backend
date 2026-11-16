// Cron único do Comercial (F5/C11): rotina diária das entregas + varredura das automações uma vez por dia (trava por
// dia em ComConfiguracao, a partir da hora em Brasília) e, a cada chamada, a fila de automações e a outbox.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { agoraEmBrasilia, CHAVE_ROTINA, horaDaRotina, rodarRotinaDiariaSeHora } from "@/lib/comercial/rotina-diaria";
import { GET as cron } from "@/app/api/cron/comercial/route";

test("hora de Brasília e hora configurável", () => {
  assert.deepEqual(agoraEmBrasilia(new Date("2026-11-16T09:59:00Z")), { dia: "2026-11-16", hora: 6 });
  assert.deepEqual(agoraEmBrasilia(new Date("2026-11-17T02:30:00Z")), { dia: "2026-11-16", hora: 23 }, "dia local, não UTC");
  assert.equal(horaDaRotina({} as never), 7);
  assert.equal(horaDaRotina({ COMERCIAL_HORA_ROTINA: "5" } as never), 5);
  assert.equal(horaDaRotina({ COMERCIAL_HORA_ROTINA: "25" } as never), 7);
});

test("rotina diária: fora da hora não roda; roda uma vez por dia, mesmo com chamadas simultâneas", async () => {
  const antes = await prisma.comConfiguracao.findUnique({ where: { chave: CHAVE_ROTINA } });
  await prisma.comConfiguracao.deleteMany({ where: { chave: CHAVE_ROTINA } });
  try {
    const cedo = new Date("2030-03-10T09:00:00Z"); // 6h em Brasília
    assert.equal((await rodarRotinaDiariaSeHora(cedo)).status, "fora-da-hora");
    const hora = new Date("2030-03-10T10:05:00Z"); // 7h05
    const [a, b] = await Promise.all([rodarRotinaDiariaSeHora(hora), rodarRotinaDiariaSeHora(hora)]);
    assert.deepEqual([a.status, b.status].sort(), ["ja-rodou", "rodou"], "duas chamadas ao mesmo tempo: uma roda");
    const r = a.status === "rodou" ? a : b;
    assert.ok(r.status === "rodou" && typeof r.entregas.erros === "number" && typeof r.varredura.avaliadas === "number");
    assert.equal((await rodarRotinaDiariaSeHora(new Date("2030-03-10T20:00:00Z"))).status, "ja-rodou", "mesmo dia, mais tarde");
    assert.equal((await rodarRotinaDiariaSeHora(new Date("2030-03-11T10:00:00Z"))).status, "rodou", "dia seguinte");
    assert.equal((await prisma.comConfiguracao.findUnique({ where: { chave: CHAVE_ROTINA } }))!.valor, "2030-03-11");
  } finally {
    await prisma.comConfiguracao.deleteMany({ where: { chave: CHAVE_ROTINA } });
    if (antes) await prisma.comConfiguracao.create({ data: { chave: CHAVE_ROTINA, valor: antes.valor } });
  }
});

test("rota do cron: 401 sem CRON_SECRET; com o segredo devolve cada parte (rotina, automações, eventos, contratos, Central)", async () => {
  const antes = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "segredo-de-cron-de-teste-123456";
  try {
    assert.equal((await cron(new Request("http://x/api/cron/comercial"))).status, 401);
    assert.equal((await cron(new Request("http://x/api/cron/comercial", { headers: { authorization: "Bearer errado" } }))).status, 401);
    const r = await cron(new Request("http://x/api/cron/comercial", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ["automacoes", "central", "contratos", "eventos", "ok", "rotina"]);
    assert.ok(["rodou", "ja-rodou", "fora-da-hora"].includes(j.rotina.status) || j.rotina.erro, JSON.stringify(j.rotina));
    assert.equal(typeof j.automacoes.executadas, "number");
  } finally { if (antes === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = antes; }
});
