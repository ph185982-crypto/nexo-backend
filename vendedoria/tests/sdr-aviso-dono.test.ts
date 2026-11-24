// 22/11/2026: bastões que não chegavam ao WhatsApp do Pedro (janela de 24 h fechada: a Meta aceitava e descartava) e
// o portão que travava quem está começando do zero pedindo "nome da empresa".
import test from "node:test";
import assert from "node:assert/strict";
import { ehIniciante, faltandoParaHandoff, decidirHandoff } from "@/lib/ai/sdr/handoff-gate";
import { SDR_EMPTY_SESSION, type SDRSession } from "@/lib/ai/sdr/types";

process.env.OWNER_WHATSAPP_NUMBER = "5562984465388";
const AGORA = new Date("2026-11-21T03:10:30Z");

// Sessão real do Giliardo (21/11) com o nome que ele deu no começo da conversa.
const giliardo = (extra: Partial<SDRSession> = {}): SDRSession => ({
  ...SDR_EMPTY_SESSION, nome: "Giliardo", cnpj: "nao tem", segmento: "moda fitness", loja_fisica: "nao",
  faturamento_total: "Não faturei", disponibilidade: "terça à tarde", ...extra,
});

test("iniciante (não fatura): não exige empresa, loja física nem dor com número — o Giliardo vai para o Pedro", () => {
  assert.equal(ehIniciante(giliardo()), true);
  assert.deepEqual(faltandoParaHandoff(giliardo(), AGORA), []);
  assert.equal(decidirHandoff("continue", giliardo(), AGORA).acao, "handoff");
  // sem o nome ainda falta o nome (o resto não)
  assert.deepEqual(faltandoParaHandoff(giliardo({ nome: "" }), AGORA), ["nome"]);
});

test("quem já fatura continua precisando de empresa, dor e loja física", () => {
  const s = giliardo({ faturamento_total: "5 mil" });
  assert.equal(ehIniciante(s), false);
  const f = faltandoParaHandoff(s, AGORA);
  for (const item of ["empresa", "dor"]) assert.ok(f.includes(item as never), item);
});

test("aviso ao dono: reconhece o número do Pedro em qualquer grafia e só manda texto com a janela de 24 h aberta", async () => {
  const { ehDono, podeMandarTexto } = await import("@/lib/whatsapp/aviso-dono-regras");
  for (const n of ["5562984465388", "556284465388", "62984465388", "+55 (62) 98446-5388"]) assert.equal(ehDono(n), true, n);
  assert.equal(ehDono("5562994854924"), false);
  const agora = new Date("2026-11-21T21:00:40Z");
  // Caso Marles: última mensagem do Pedro 20/11 19:12 → 25,8 h → janela fechada, não manda texto (a Meta descartaria)
  assert.equal(podeMandarTexto(new Date("2026-11-20T19:12:18Z"), agora), false);
  // Pedro escreveu há 2 h → manda
  assert.equal(podeMandarTexto(new Date("2026-11-21T19:00:00Z"), agora), true);
  // Sem histórico do Pedro neste número: tenta (comportamento antigo)
  assert.equal(podeMandarTexto(null, agora), true);
});

test("alerta de saldo: com OpenAI de reserva a DeepSeek sem saldo NÃO diz que a IA parou; sem reserva diz", async () => {
  const { textoAlertaCota } = await import("@/lib/ai/alerta-cota-texto");
  const com = textoAlertaCota("DeepSeek", "Insufficient Balance", true);
  assert.match(com.titulo, /atendendo pela OpenAI/); assert.doesNotMatch(com.corpo, /mensagem de espera|parou de responder/);
  const sem = textoAlertaCota("DeepSeek", "Insufficient Balance", false);
  assert.match(sem.titulo, /a IA parou de responder/);
  assert.match(textoAlertaCota("OpenAI", "x", true).titulo, /OpenAI sem créditos/);
});
