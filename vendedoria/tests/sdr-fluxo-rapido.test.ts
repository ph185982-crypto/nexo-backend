import { test } from "node:test";
import assert from "node:assert/strict";
import { perguntaCombinada, forcarProximoPasso, leadPerguntou } from "../src/lib/ai/sdr/fluxo-rapido";
import { promptFollowupSdr } from "../src/lib/followup/conteudo";
import { SDR_EMPTY_SESSION, type SDRSession } from "../src/lib/ai/sdr/types";

const slots = [
  { inicio: new Date("2026-10-26T13:00:00Z"), label: "hoje às 10h" },
  { inicio: new Date("2026-10-26T18:00:00Z"), label: "amanhã às 15h" },
] as never[];

test("junta até 2 itens pendentes numa só pergunta", () => {
  assert.equal(perguntaCombinada(["nome", "empresa", "dor"]), "Qual seu nome e qual o nome da empresa ou loja?");
  assert.equal(perguntaCombinada(["dor"]), "O que mais trava suas vendas hoje?");
});

test("só falta o horário: oferece dois horários reais", () => {
  const p = perguntaCombinada(["horario"], slots as never);
  assert.match(p, /hoje às 10h ou amanhã às 15h/);
});

test("caso Maysmodas: lead qualificado + modelo pergunta fora do roteiro → vira nome/empresa", () => {
  const modelo = [
    { text: "Perfeito, isso facilita bastante na estruturação da operação nos marketplaces", delay: 0 },
    { text: "Você já teve experiência vendendo em marketplaces antes, ou seria a primeira vez?", delay: 1500 },
  ];
  const r = forcarProximoPasso(modelo, ["nome", "empresa", "dor", "horario"], []);
  assert.equal(r.length, 2);
  assert.match(r[0].text, /Perfeito/);
  assert.equal(r[1].text, "Qual seu nome e qual o nome da empresa ou loja?");
  assert.ok(!r.some((m) => /marketplaces antes/.test(m.text)));
});

test("detecta pergunta do lead", () => {
  assert.equal(leadPerguntou("Como funciona?"), true);
  assert.equal(leadPerguntou("Sim sim"), false);
});

test("follow-up de lead já no ICP convida para a ligação em vez de repetir pergunta", () => {
  const s: SDRSession = { ...SDR_EMPTY_SESSION, mode: "SDR", faturamento_total: "150000", cnpj: "tem", loja_fisica: "sim" };
  const p = promptFollowupSdr(1, 4, s);
  assert.match(p, /ligação de 20 min com o Pedro/);
  assert.match(p, /nem a última que a Nexo fez/);
});
