import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarRepetidas, pareceFechamento } from "../src/lib/ai/sdr/anti-repeticao";

test("não repete pergunta já enviada (caso real: nome da empresa / faturamento)", () => {
  const antes = [
    "Perfeito, Cleverson! E só pra entender melhor, você já tem algum nome de empresa ou loja em mente pra quando começar a vender?",
    "E quanto ao faturamento mensal que você planeja, tem alguma ideia de quanto seria?",
  ];
  const novas = [
    { text: "Perfeito, Cleverson! E só pra entender melhor, você já tem algum nome de empresa ou loja em mente pra quando começar a vender?", delay: 0 },
    { text: "E quanto ao faturamento mensal que você planeja, tem alguma ideia de quanto seria?", delay: 0 },
    { text: "Legal! E qual seria o nome da empresa ou loja?", delay: 0 },
  ];
  assert.deepEqual(filtrarRepetidas(novas, antes).map((m) => m.text), ["Legal! E qual seria o nome da empresa ou loja?"]);
});

test("ignora acento, caixa e pontuação ao comparar; não duplica na mesma resposta", () => {
  const r = filtrarRepetidas([{ text: "Ótimo!" }, { text: "otimo" }, { text: "Outra" }], ["ÓTIMO"]);
  assert.deepEqual(r.map((m) => m.text), ["Outra"]);
});

test("detecta fechamento prometendo ligação", () => {
  assert.ok(pareceFechamento("Ótimo, Cleverson! Vamos deixar agendado pra te chamarmos amanhã."));
  assert.ok(pareceFechamento("Nosso especialista vai te ajudar com os detalhes."));
  assert.ok(!pareceFechamento("E qual o faturamento mensal da loja?"));
});
