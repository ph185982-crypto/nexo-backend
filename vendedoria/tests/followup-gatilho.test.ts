// Item 3 (30/10): follow-ups saem sem depender de CRON_SECRET nem do GitHub.
import test from "node:test";
import assert from "node:assert/strict";

const temBanco = Boolean(process.env.DATABASE_URL);

test("gatilho: sem vencidos → 'nada'; chamada seguinte dentro de 60s → 'throttle'", { skip: !temBanco }, async () => {
  const { acionarFollowupsSePreciso, _resetGatilho } = await import("@/lib/followup/gatilho");
  const { prisma } = await import("@/lib/prisma/client");
  _resetGatilho();
  // Garante que não há vencidos de outros testes.
  await prisma.conversationFollowUp.updateMany({ where: { status: "ACTIVE", nextSendAt: { lte: new Date() } }, data: { nextSendAt: new Date(Date.now() + 3_600_000) } });
  assert.equal(await acionarFollowupsSePreciso("teste"), "nada");
  assert.equal(await acionarFollowupsSePreciso("teste"), "throttle");
  _resetGatilho();
  assert.equal(await acionarFollowupsSePreciso("teste", { forcar: true }), "nada");
  await prisma.$disconnect();
});

test("processador exportado da lib e rota do cron continua exigindo segredo", async () => {
  const { processarFollowupsVencidos } = await import("@/lib/followup/processar");
  assert.equal(typeof processarFollowupsVencidos, "function");
  const { readFileSync } = await import("node:fs");
  const rota = readFileSync(new URL("../src/app/api/cron/followup/route.ts", import.meta.url), "utf8");
  assert.match(rota, /CRON_SECRET/);
  assert.match(rota, /processarFollowupsVencidos/);
});
