import { test } from "node:test";
import assert from "node:assert/strict";
import { CADENCIA_HORAS, MAX_FOLLOWUPS, dataDoToque } from "../src/lib/followup/cadencia";

const H = 3600_000;

test("cadência da Júlia: 24h e 72h contadas da mesma mensagem", () => {
  assert.deepEqual([...CADENCIA_HORAS], [24, 72]);
  assert.equal(MAX_FOLLOWUPS, 2);
  const base = new Date("2026-10-25T12:00:00Z");
  const horas = [1, 2].map((s) => (dataDoToque(s, base, base).getTime() - base.getTime()) / H);
  assert.deepEqual(horas, [24, 72]);
});

test("toque atrasado nunca é agendado no passado", () => {
  const base = new Date("2026-10-25T00:00:00Z");
  const agora = new Date("2026-10-25T10:00:00Z");
  assert.ok(dataDoToque(1, base, agora).getTime() > agora.getTime());
});
