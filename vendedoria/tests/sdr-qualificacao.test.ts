import test from "node:test";
import assert from "node:assert/strict";
import { parseFaturamentoMensal, temCnpjConfirmado, avaliarQualificacao } from "@/lib/ai/sdr/qualificacao";
import { eventoDaColuna } from "@/lib/crm/funil-config";

test("parseFaturamentoMensal: formatos comuns", () => {
  const casos: Array<[string, number | null]> = [
    ["R$ 40 mil", 40000],
    ["40k", 40000],
    ["50.000", 50000],
    ["R$ 50.000,00 por mês", 50000],
    ["1,5 milhão", 1500000],
    ["60 mil/mês", 60000],
    ["600 mil por ano", 50000],
    ["entre 30 e 50 mil", 30000], // faixa → piso
    ["uns 35 mil", 35000],
    ["50,000", 50000],
    ["não sei", null],
    ["", null],
  ];
  for (const [entrada, esperado] of casos) assert.equal(parseFaturamentoMensal(entrada), esperado, `"${entrada}"`);
  assert.equal(parseFaturamentoMensal(undefined), null);
});

test("temCnpjConfirmado", () => {
  assert.equal(temCnpjConfirmado("12.345.678/0001-90"), true);
  assert.equal(temCnpjConfirmado("sim"), true);
  assert.equal(temCnpjConfirmado("tem, é MEI"), true);
  assert.equal(temCnpjConfirmado("Tenho CNPJ ativo"), true);
  assert.equal(temCnpjConfirmado("não tem"), false);
  assert.equal(temCnpjConfirmado("não"), false);
  assert.equal(temCnpjConfirmado("vai regularizar durante a implantação"), false);
  assert.equal(temCnpjConfirmado("vou abrir mês que vem"), false);
  assert.equal(temCnpjConfirmado(""), false);
});

test("avaliarQualificacao: os três critérios", () => {
  const ok = avaliarQualificacao({ tem_loja_fisica: true, faturamento_total: "R$ 45 mil por mês", cnpj: "sim" });
  assert.equal(ok.qualificado, true);
  assert.deepEqual(ok.faltando, []);
  assert.equal(ok.faturamentoMensal, 45000);
});

test("avaliarQualificacao: o que falta fica listado", () => {
  assert.deepEqual(avaliarQualificacao({ tem_loja_fisica: false, faturamento_total: "50 mil", cnpj: "sim" }).faltando, ["loja_fisica"]);
  assert.deepEqual(avaliarQualificacao({ tem_loja_fisica: true, faturamento_total: "39 mil", cnpj: "sim" }).faltando, ["faturamento"]);
  assert.deepEqual(avaliarQualificacao({ tem_loja_fisica: true, faturamento_total: "50 mil", cnpj: "não tem" }).faltando, ["cnpj"]);
  assert.deepEqual(
    avaliarQualificacao({ tem_loja_fisica: false, faturamento_total: "", cnpj: "" }).faltando,
    ["loja_fisica", "faturamento", "cnpj"],
  );
});

test("avaliarQualificacao: limite exato de R$ 40.000 qualifica; loja física citada nos canais conta", () => {
  assert.equal(avaliarQualificacao({ tem_loja_fisica: true, faturamento_total: "40.000", cnpj: "sim" }).qualificado, true);
  assert.equal(avaliarQualificacao({ tem_loja_fisica: true, faturamento_total: "39.999", cnpj: "sim" }).qualificado, false);
  assert.equal(
    avaliarQualificacao({ tem_loja_fisica: false, canais_atuais: ["Instagram", "Loja física"], faturamento_total: "50 mil", cnpj: "sim" }).qualificado,
    true,
  );
});

test("eventoDaColuna: layout canônico e legado", () => {
  assert.equal(eventoDaColuna({ type: "GANHO", name: "Ganho" }), "Purchase");
  assert.equal(eventoDaColuna({ type: "CUSTOM", name: "Qualificados" }), "LeadSubmitted"); // legado
  assert.equal(eventoDaColuna({ type: "PROPOSTA_NEGOCIACAO", name: "Proposta e Negociação" }), "LeadSubmitted"); // canônico
  // etapas seguintes NÃO disparam LeadSubmitted (agentes movem para lá sem checar o ICP)
  assert.equal(eventoDaColuna({ type: "CONTRATO", name: "Em Contrato" }), null);
  assert.equal(eventoDaColuna({ type: "PROPOSTA", name: "Proposta" }), null);
  assert.equal(eventoDaColuna({ type: "TRIAGE", name: "Novos" }), null);
  assert.equal(eventoDaColuna({ type: "CUSTOM", name: "Em qualificação" }), null);
  assert.equal(eventoDaColuna({ type: "LOST", name: "Fora do ICP" }), null);
  assert.equal(eventoDaColuna({ type: "ESCALATED", name: "Handoff enviado" }), null);
});

import { agregarPorAnuncio } from "@/lib/anuncios";

test("agregarPorAnuncio: leads, qualificados, ganhos e valor por anúncio", () => {
  const col = (type: string, name: string) => ({ type, name });
  const r = agregarPorAnuncio([
    { adSourceId: "A1", adHeadline: "Anúncio 1", valorContrato: null, kanbanColumn: col("TRIAGE", "Novos") },
    { adSourceId: "A1", adHeadline: null, valorContrato: null, kanbanColumn: col("CUSTOM", "Qualificados") },
    { adSourceId: "A1", adHeadline: null, valorContrato: 5000, kanbanColumn: col("GANHO", "Ganho") },
    { adSourceId: "A1", adHeadline: null, valorContrato: null, kanbanColumn: col("GANHO", "Ganho") },
    { adSourceId: "A1", adHeadline: null, valorContrato: null, kanbanColumn: col("CONTRATO", "Em Contrato") },
    { adSourceId: "A2", adHeadline: "Anúncio 2", valorContrato: null, kanbanColumn: col("LOST", "Fora do ICP") },
    { adSourceId: null, adHeadline: null, valorContrato: null, kanbanColumn: null },
  ]);
  const a1 = r.anuncios.find((a) => a.adSourceId === "A1")!;
  assert.deepEqual(
    [a1.leads, a1.qualificados, a1.ganhos, a1.valorGanho, a1.ganhosSemValor, a1.adHeadline],
    [5, 4, 2, 5000, 1, "Anúncio 1"],
  );
  assert.equal(r.anuncios[0].adSourceId, "A1"); // ordenado por leads
  assert.deepEqual(r.total, { leads: 7, qualificados: 4, ganhos: 2, valorGanho: 5000, ganhosSemValor: 1 });
});
