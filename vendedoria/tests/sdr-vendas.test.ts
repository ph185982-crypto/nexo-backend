import test from "node:test";
import assert from "node:assert/strict";
import { pareceNomeDePessoa, dorEspecifica, faltandoParaHandoff, decidirHandoff } from "@/lib/ai/sdr/handoff-gate";
import { perfilComunicacao } from "@/lib/ai/sdr/estilo";
import { gerarSlots, horarioAceitavel, partesBRT, deBRT, rotuloSlot } from "@/lib/agenda/slots";
import { dentroDaJanela, planejarEnvio, proximoEnvio } from "@/lib/followup/janela";
import { fallbackFollowupSdr, primeiroNome } from "@/lib/followup/conteudo";
import { SDR_EMPTY_SESSION, type SDRSession } from "@/lib/ai/sdr/types";

// Segunda-feira 26/10/2026 10:00 em Brasília = 13:00 UTC
const AGORA = new Date("2026-10-26T13:00:00Z");

test("pareceNomeDePessoa: nomes reais × apelidos de perfil (casos reais de produção)", () => {
  for (const ok of ["Geovana Martins", "Ana", "João Pedro", "Maria das Graças", "D'Ávila", "Ivone"]) assert.equal(pareceNomeDePessoa(ok), true, ok);
  for (const nao of ["DJ$", "💨", "Deus abençoe a minha família", "Adriano Dricar Acessorios", "Advocacia especializada",
    "alicia baby 🛍️😍", "_santos_fml😇", "Lipx🥶", "Loja Bella", "", "a", "Studio Ana Modas"]) {
    assert.equal(pareceNomeDePessoa(nao), false, nao);
  }
});

test("dorEspecifica", () => {
  assert.equal(dorEspecifica("vender mais"), false);
  assert.equal(dorEspecifica("Vendeu na Shopee por um mês e depois parou, sem mais vendas"), true);
  assert.equal(dorEspecifica(""), false);
});

const completo = (extra: Partial<SDRSession> = {}): SDRSession => ({
  ...SDR_EMPTY_SESSION,
  nome: "Carla Souza", empresa: "Bella Modas", segmento: "moda feminina",
  problema_principal: "Vende bem na loja mas a Shopee parou em 3 pedidos por semana",
  faturamento_total: "60 mil por mês", loja_fisica: "sim", tem_loja_fisica: true, cnpj: "tem",
  horario_reuniao: deBRT(2026, 10, 27, 10).toISOString(),
  ...extra,
});

test("handoff: lead real de 23/10 (R$ 5 mil, sem loja) vira nurture, nunca handoff", () => {
  const geovana: SDRSession = {
    ...SDR_EMPTY_SESSION, nome: "Geovana Martins", cnpj: "tem", canais_atuais: ["WhatsApp", "Instagram", "Shopee"],
    disponibilidade: "9 hrs", tem_loja_fisica: false, loja_fisica: "nao", faturamento_total: "5.000,00",
    problema_principal: "Vendeu na Shopee por um mês e depois parou, sem mais vendas", empresa: "Gê Acessórios",
  };
  const d = decidirHandoff("handoff", geovana, AGORA);
  assert.equal(d.acao, "nurture");
  assert.equal(d.foraDoIcp, true);
  assert.match(d.correcao ?? "", /NÃO faça handoff/);
});

test("handoff: lead real 'DJ$' (apelido, sem faturamento) continua qualificando", () => {
  const dj: SDRSession = {
    ...SDR_EMPTY_SESSION, nome: "DJ$", cnpj: "não tem", canais_atuais: ["loja física de suplementos"],
    disponibilidade: "amanhã", faturamento_total: "em transição", problema_principal: "migrar rapidamente para o online",
  };
  const d = decidirHandoff("handoff", dj, AGORA);
  assert.equal(d.acao, "continue");
  assert.ok(d.faltando.includes("nome"));
  assert.ok(d.faltando.includes("faturamento"));
});

test("handoff: tudo completo e no ICP com horário → handoff; sem horário → continue pedindo horário", () => {
  assert.equal(decidirHandoff("handoff", completo(), AGORA).acao, "handoff");
  const semHora = decidirHandoff("handoff", completo({ horario_reuniao: undefined }), AGORA);
  assert.equal(semHora.acao, "continue");
  assert.deepEqual(semHora.faltando, ["horario"]);
});

test("handoff: só intervém quando o modelo pediu handoff", () => {
  assert.equal(decidirHandoff("continue", completo(), AGORA).acao, "continue");
  assert.equal(decidirHandoff("close", { ...SDR_EMPTY_SESSION }, AGORA).acao, "close");
});

test("faltandoParaHandoff: sessão vazia pede tudo, na ordem", () => {
  assert.deepEqual(faltandoParaHandoff({ ...SDR_EMPTY_SESSION }, AGORA),
    ["nome", "empresa", "segmento", "dor", "faturamento", "loja_fisica", "cnpj", "horario"]);
});

test("perfilComunicacao: curto/informal × formal/longo × áudio", () => {
  const curto = perfilComunicacao(["oi", "vc faz isso?", "blz"])!;
  assert.equal(curto.tamanho, "curto");
  assert.equal(curto.formalidade, "informal");
  const formal = perfilComunicacao([
    "Bom dia, gostaria de entender melhor como funciona o serviço de vocês para a minha empresa.",
    "Poderia me explicar, por gentileza, quais marketplaces vocês atendem atualmente?",
  ])!;
  assert.equal(formal.formalidade, "formal");
  assert.match(formal.instrucao, /cordialidade/);
  const audio = perfilComunicacao(["[Áudio transcrito]: então eu tenho uma loja..."])!;
  assert.equal(audio.usaAudio, true);
  assert.equal(perfilComunicacao([]), null);
});

test("slots: dias úteis, horário de Brasília, 2 por dia espalhados, respeitando ocupados", () => {
  const slots = gerarSlots({ agora: AGORA, horas: [9, 10, 11, 14, 15, 16, 17] });
  assert.equal(slots.length, 4);
  for (const s of slots) {
    const p = partesBRT(s.inicio);
    assert.ok(p.diaSemana >= 1 && p.diaSemana <= 5);
    assert.ok(s.inicio.getTime() >= AGORA.getTime() + 90 * 60_000);
  }
  // 1º slot hoje (segunda): 10h já passou a antecedência → 14h é o primeiro (11h30 é o limite)
  assert.equal(partesBRT(slots[0].inicio).hora, 14);
  // sexta 17h → próximos caem na segunda (pula fim de semana)
  const sexta = new Date("2026-10-30T20:30:00Z"); // 17h30 BRT
  const s2 = gerarSlots({ agora: sexta });
  assert.equal(partesBRT(s2[0].inicio).diaSemana, 1);
  // ocupado às 14h → pula
  const ocupado = { start: deBRT(2026, 10, 26, 14).getTime(), end: deBRT(2026, 10, 26, 15).getTime() };
  const s3 = gerarSlots({ agora: AGORA, ocupados: [ocupado] });
  assert.notEqual(partesBRT(s3[0].inicio).hora, 14);
});

test("rotuloSlot e horarioAceitavel", () => {
  assert.equal(rotuloSlot(deBRT(2026, 10, 26, 15), AGORA), "hoje às 15h");
  assert.equal(rotuloSlot(deBRT(2026, 10, 27, 10), AGORA), "amanhã (terça, 27/10) às 10h");
  assert.equal(rotuloSlot(deBRT(2026, 10, 28, 14), AGORA), "quarta (28/10) às 14h");
  assert.ok(horarioAceitavel(deBRT(2026, 10, 27, 10).toISOString(), AGORA));
  assert.equal(horarioAceitavel(deBRT(2026, 10, 31, 10).toISOString(), AGORA), null); // sábado
  assert.equal(horarioAceitavel(deBRT(2026, 10, 27, 22).toISOString(), AGORA), null); // fora do expediente
  assert.equal(horarioAceitavel(deBRT(2026, 10, 26, 10, 30).toISOString(), AGORA), null); // daqui a 30 min
  assert.equal(horarioAceitavel("não é data", AGORA), null);
});

test("janela de 24h: texto livre só dentro; fora → template ou sem canal", () => {
  const ultima = new Date(AGORA.getTime() - 3 * 3_600_000); // cliente falou há 3h
  assert.equal(dentroDaJanela(ultima, AGORA), true);
  const velha = new Date(AGORA.getTime() - 25 * 3_600_000);
  assert.equal(dentroDaJanela(velha, AGORA), false);
  assert.deepEqual(planejarEnvio(velha, AGORA, null), { modo: "sem_canal" });
  assert.equal(planejarEnvio(velha, AGORA, { nome: "retomar_v1", idioma: "pt_BR", comNome: true }).modo, "template");
  assert.equal(planejarEnvio(ultima, AGORA, null).modo, "texto");
});

test("proximoEnvio: sem template puxa o toque para antes da janela fechar", () => {
  const ultima = AGORA; // cliente acabou de falar
  const em4h = new Date(AGORA.getTime() + 4 * 3_600_000);
  assert.equal(proximoEnvio(em4h, ultima, AGORA, false)?.getTime(), em4h.getTime());
  const em48h = new Date(AGORA.getTime() + 48 * 3_600_000);
  const puxado = proximoEnvio(em48h, ultima, AGORA, false)!;
  assert.ok(puxado.getTime() < AGORA.getTime() + 24 * 3_600_000);
  assert.ok(puxado.getTime() > AGORA.getTime() + 22 * 3_600_000);
  // janela quase fechando: não cabe mais nada
  const quaseFechando = new Date(AGORA.getTime() - 23 * 3_600_000);
  assert.equal(proximoEnvio(em48h, quaseFechando, AGORA, false), null);
  // com template, mantém o desejado
  assert.equal(proximoEnvio(em48h, ultima, AGORA, true)?.getTime(), em48h.getTime());
});

test("follow-up de reserva é B2B (sem 'estoque') e só usa nome de pessoa", () => {
  for (let step = 1; step <= 4; step++) assert.doesNotMatch(fallbackFollowupSdr(step, 4, "Carla"), /estoque|unidades|fechar hoje/i);
  assert.equal(primeiroNome("Carla Souza"), "Carla");
  assert.equal(primeiroNome("DJ$"), null);
  assert.doesNotMatch(fallbackFollowupSdr(1, 4, "DJ$"), /DJ/);
});
