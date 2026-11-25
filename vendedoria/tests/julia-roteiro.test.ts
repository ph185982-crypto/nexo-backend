// Testes de aceite do roteiro da Júlia (SDR Avanteza, 24/11/2026). Simulam as conversas inteiras pelo motor do roteiro
// (src/lib/ai/sdr/julia/motor.ts) com respostas do modelo ROTEIRIZADAS — o que é decidido no código (rota, perguntas,
// horários, passagem, follow-up, resposta automática) é testado de verdade; o texto livre do modelo é simulado.
// JULIA_MOSTRAR=1 imprime as conversas.
import test from "node:test";
import assert from "node:assert/strict";
import { SDR_EMPTY_SESSION, type SDRSession, type SDRLLMResponse } from "@/lib/ai/sdr/types";
import { turnoAbertura, turnoJulia, turnoPosPassagem, turnoRespostaAutomatica, planoFollowup, limparMensagensDoModelo, MOTIVO_SEM_RESPOSTA } from "@/lib/ai/sdr/julia/motor";
import { gerarSlotsLigacao, deBRT, rotuloSlot, type Slot } from "@/lib/agenda/slots";
import { textosConfirmacao, ROTEIRO_JULIA, PROIBIDO } from "@/lib/ai/sdr/julia/roteiro";
import { faturamentoParaLead, lerFaixa, ehPrioridade, classificar } from "@/lib/ai/sdr/julia/icp";
import { ehRespostaAutomatica, escolherSlot } from "@/lib/ai/sdr/julia/sinais";
import { eventoDaColuna } from "@/lib/crm/funil-config";

// Terça 24/11/2026 9h em Brasília
const AGORA = deBRT(2026, 11, 24, 9, 0);
const SLOTS: Slot[] = gerarSlotsLigacao({ agora: AGORA, horarios: [[12, 15], [18, 30]] });
const llm = (texto: string[] = [], update: Record<string, unknown> = {}): SDRLLMResponse => ({ messages: texto.map((t) => ({ text: t, delay: 0 })), updateSession: update as Partial<SDRSession>, action: "continue" });

type Passo = { lead: string; llm?: SDRLLMResponse | null };
interface Resultado { conversa: string[]; sessao: SDRSession; acoes: string[]; todasDaJulia: string[] }

/** Roda a conversa: abertura → turnos → passagem (simulada como em efeitos.ts) → pós-passagem. */
function simular(nome: string, passos: Passo[]): Resultado {
  let s: SDRSession = { ...SDR_EMPTY_SESSION };
  const conversa: string[] = []; const acoes: string[] = []; const todasDaJulia: string[] = [];
  const julia = (t: string) => { conversa.push(`  Júlia: ${t.replace(/\n/g, "\n         ")}`); todasDaJulia.push(t); };
  passos.forEach((p, i) => {
    conversa.push(`  Lead:  ${p.lead}`);
    if (s.etapa === "ligacao_marcada" || s.etapa === "remarcando") {
      const o = turnoPosPassagem({ sessao: s, mensagem: p.lead, slotsLivres: SLOTS, agora: AGORA });
      acoes.push(o.acao); o.mensagens.forEach(julia); s = o.sessao;
      if (!o.mensagens.length) conversa.push("  (Júlia em silêncio)");
      return;
    }
    const auto = turnoRespostaAutomatica(s, p.lead, i > 0 ? passos[i - 1].lead : null, AGORA);
    if (auto) { acoes.push(auto.acao); s = auto.sessao; conversa.push(`  (resposta automática → ${auto.acao})`); return; }
    const o = i === 0 ? turnoAbertura(s, p.lead) : turnoJulia({ sessao: s, mensagem: p.lead, llm: p.llm ?? null, slotsLivres: SLOTS, agora: AGORA, nomePerfil: null });
    acoes.push(o.acao); s = o.sessao;
    if (o.acao === "marcar_ligacao") {
      const rotulo = rotuloSlot(new Date(o.slotEscolhido!), AGORA);
      textosConfirmacao(rotulo, true).forEach(julia); julia("[vídeo de depoimentos]");
      s = { ...s, status: "handoff_enviado", etapa: "ligacao_marcada" };
      conversa.push("  (sistema: humanTakeover=true · card → Ligação marcada · aviso ao Pedro · LeadSubmitted)");
    } else o.mensagens.forEach(julia);
  });
  if (process.env.JULIA_MOSTRAR) console.log(`\n── ${nome} ──\n${conversa.join("\n")}\n`);
  return { conversa, sessao: s, acoes, todasDaJulia };
}

test("1. Tenho loja + moda + CNPJ + faixa 3 → 2 horários, escolhe, confirmação + 3 produtos + vídeo; depois só 'Recebi!' uma vez", () => {
  const r = simular("Cenário 1 — qualificado", [
    { lead: "Tenho loja e quero vender no Mercado Livre e na Shopee" },
    { lead: "Vendo moda feminina, tenho uma loja no centro", llm: llm(["Boa, moda feminina sai muito no marketplace."], { segmento: "moda feminina", frase_chave: "loja de moda feminina no centro" }) },
    { lead: "Sim, tenho", llm: llm(["Perfeito."]) },
    { lead: "3" },
    { lead: "Pode ser às 18h30" },
    { lead: "[Imagem recebida]" },
    { lead: "[Imagem recebida]" },
    { lead: "valeu" },
  ]);
  assert.deepEqual(r.acoes.slice(0, 5), ["abertura", "perguntar", "perguntar", "oferecer_horarios", "marcar_ligacao"]);
  assert.equal(r.sessao.faixa_faturamento, 3);
  assert.equal(faturamentoParaLead(r.sessao), 75_000);
  assert.ok(ehPrioridade(r.sessao), "≥ 50 mil → tag Prioridade");
  assert.equal(classificar(r.sessao), "QUALIFICADO");
  assert.match(r.todasDaJulia.join("\n"), /Ele pode te ligar hoje às 12h15 ou hoje às 18h30\. Qual fica melhor pra você\?/);
  assert.match(r.todasDaJulia.join("\n"), /Fechado: hoje às 18h30\. O Pedro te liga do \(62\) 98446-5388\./);
  assert.match(r.todasDaJulia.join("\n"), /foto de 3 produtos/);
  assert.deepEqual(r.acoes.slice(5), ["recebi_foto", "silencio", "silencio"]);
  assert.equal(r.todasDaJulia.filter((t) => t === "Recebi! Já passei pro Pedro 🙂").length, 1);
  // "Ligação marcada" (ESCALATED) dispara LeadSubmitted; "Ganho" dispara Purchase
  assert.equal(eventoDaColuna({ type: "ESCALATED", name: "Ligação marcada" }), "LeadSubmitted");
  assert.equal(eventoDaColuna({ type: "CUSTOM", name: "Qualificados" }), "LeadSubmitted");
  assert.equal(eventoDaColuna({ type: "GANHO", name: "Ganho" }), "Purchase");
});

test("2. Loja + CNPJ + faixa 1 (até 20 mil) também é QUALIFICADO (faturamento não elimina)", () => {
  const r = simular("Cenário 2 — faixa 1", [
    { lead: "Tenho loja e quero vender no Mercado Livre e na Shopee" },
    { lead: "calçados", llm: llm(["Boa!"], { segmento: "calçados" }) },
    { lead: "tenho cnpj sim" },
    { lead: "1" },
  ]);
  assert.equal(r.acoes.at(-1), "oferecer_horarios");
  assert.equal(r.sessao.icp, "QUALIFICADO");
  assert.equal(faturamentoParaLead(r.sessao), 10_000);
  assert.ok(!ehPrioridade(r.sessao));
});

test("3. Começando agora, sem loja/estoque → rota FORA em até 2 mensagens do lead; sem follow-up", () => {
  const r = simular("Cenário 3 — fora", [
    { lead: "Estou começando agora" },
    { lead: "Não tenho nenhum dos dois ainda" },
  ]);
  assert.deepEqual(r.acoes, ["abertura", "fora"]);
  assert.match(r.todasDaJulia.join("\n"), /ainda não é o momento/);
  assert.equal(planoFollowup(r.sessao, 1, SLOTS).acao, "pular");
});

test("4. Loja sem CNPJ → MORNO; sem follow-up", () => {
  const r = simular("Cenário 4 — morno", [
    { lead: "Tenho loja e quero vender no Mercado Livre e na Shopee" },
    { lead: "Bolsas", llm: llm(["Legal!"], { segmento: "bolsas" }) },
    { lead: "Não tenho CNPJ" },
  ]);
  assert.equal(r.acoes.at(-1), "morno");
  assert.match(r.todasDaJulia.join("\n"), /precisa de CNPJ ativo/);
  assert.equal(planoFollowup(r.sessao, 1, SLOTS).acao, "pular");
});

test("5. Some depois da 1ª pergunta → follow-up em 24 h e 72 h, depois 'Perdido' (sem resposta)", () => {
  const r = simular("Cenário 5 — sumiu", [{ lead: "Já vendo nos marketplaces e quero crescer" }]);
  const f1 = planoFollowup(r.sessao, 1, SLOTS);
  assert.equal(f1.acao, "enviar"); assert.match(f1.texto!, /me responde só com o número: 1\) tenho loja ou estoque 2\) vendo só online 3\) estou começando/);
  assert.equal(f1.encerrar, false);
  const f2 = planoFollowup(f1.sessao, 2, SLOTS);
  assert.match(f2.texto!, /Vou encerrar por aqui/); assert.equal(f2.encerrar, true); assert.equal(f2.perdido, MOTIVO_SEM_RESPOSTA);
  // e a resposta "1" ao 1º follow-up vale como "tenho loja ou estoque"
  const volta = turnoJulia({ sessao: f1.sessao, mensagem: "1", llm: null, slotsLivres: SLOTS, agora: AGORA });
  assert.equal(volta.sessao.loja_fisica, "sim");
});

test("6. Resposta automática repetida (com U+200E) → não responde, retoma 1 vez, e para na 2ª", () => {
  const auto = "‎Iharla Closet agradece seu contato. Como podemos ajudar?";
  assert.ok(ehRespostaAutomatica(auto));
  assert.ok(ehRespostaAutomatica("Olá, recebemos sua mensagem e em breve retornaremos"));
  assert.ok(!ehRespostaAutomatica("Sim, tenho loja no setor Campinas"));
  let s: SDRSession = { ...SDR_EMPTY_SESSION, etapa: "descoberta" };
  const a1 = turnoRespostaAutomatica(s, auto, null, AGORA)!; assert.equal(a1.acao, "auto_resposta_pausa"); s = a1.sessao;
  const a2 = turnoRespostaAutomatica(s, auto, auto, AGORA)!; assert.equal(a2.acao, "silencio");
  const retomada = planoFollowup(s, 1, SLOTS);
  assert.equal(retomada.texto, "Oi! Acho que caiu na resposta automática 🙂 Quem cuida da loja pode me responder por aqui?");
  assert.equal(retomada.encerrar, true); s = retomada.sessao;
  const a3 = turnoRespostaAutomatica(s, auto, null, AGORA)!; assert.equal(a3.acao, "auto_resposta_parar");
});

test("7. 'Quanto custa?' → responde sem valores (preço do modelo é barrado) e volta ao roteiro", () => {
  const r = simular("Cenário 7 — preço", [
    { lead: "Tenho loja e quero vender no Mercado Livre e na Shopee" },
    { lead: "Quanto custa?", llm: llm(["Depende do tamanho da operação e de quantos canais. O Pedro te mostra certinho na ligação, com a conta dos seus produtos.", "A mensalidade é R$ 2.500 por mês."]) },
  ]);
  const saida = r.todasDaJulia.slice(-3).join("\n");
  assert.match(saida, /Depende do tamanho da operação/);
  assert.doesNotMatch(saida, /R\$\s?\d/);
  assert.match(saida, /CNPJ ativo\?/);
});

test("8 e 11. 'Você é robô?' / 'Por que aparece Pedro?' → resposta de assistente virtual, a Júlia segue o roteiro", () => {
  assert.match(ROTEIRO_JULIA, /Sou a assistente virtual da Avanteza 🙂 Quem conversa com você na ligação é o Pedro, fundador\./);
  assert.match(ROTEIRO_JULIA, /Esse é o WhatsApp comercial da Avanteza 🙂 Eu sou a Júlia, assistente virtual\. O Pedro é o fundador e é quem faz a ligação com você\./);
  const r = simular("Cenário 8/11 — robô e Pedro", [
    { lead: "Olá! Vi o anúncio da Nexo e quero saber como estruturar minha loja na Shopee" },
    { lead: "Você é robô?", llm: llm(["Sou a assistente virtual da Avanteza 🙂 Quem conversa com você na ligação é o Pedro, fundador."]) },
    { lead: "E por que aparece Pedro aqui?", llm: llm(["Esse é o WhatsApp comercial da Avanteza 🙂 Eu sou a Júlia, assistente virtual. O Pedro é o fundador e é quem faz a ligação com você."]) },
  ]);
  assert.match(r.todasDaJulia.join("\n"), /assistente virtual da Avanteza/);
  assert.match(r.todasDaJulia.join("\n"), /WhatsApp comercial da Avanteza/);
  assert.match(r.todasDaJulia.at(-1)!, /loja física, fábrica ou atacado com estoque próprio\?/);
});

test("10. Nenhuma mensagem sai com 'Nexo' ou '600'; o que o modelo escrever assim é barrado", () => {
  const conversas = [
    simular("x", [{ lead: "Tenho loja e quero vender no Mercado Livre e na Shopee" }, { lead: "roupas", llm: llm(["A Nexo já ajudou 600 marcas!"]) }, { lead: "tenho cnpj" }, { lead: "2" }, { lead: "12h15" }]),
    simular("y", [{ lead: "Estou começando agora" }, { lead: "não" }]),
    simular("z", [{ lead: "Olá! Vi o anúncio da Nexo" }]),
  ];
  for (const c of conversas) for (const t of c.todasDaJulia) assert.doesNotMatch(t, PROIBIDO, t);
  assert.deepEqual(limparMensagensDoModelo([{ text: "Somos a Nexo" }, { text: "ok" }]), ["ok"]);
});

test("Nunca pergunta faturamento esperado/meta, nem repete pergunta já respondida", () => {
  const s: SDRSession = { ...SDR_EMPTY_SESSION, etapa: "descoberta", loja_fisica: "sim", tem_loja_fisica: true, ultima_pergunta: undefined };
  const o = turnoJulia({ sessao: s, mensagem: "vendo cosméticos", llm: llm(["Quanto você espera faturar no marketplace?", "Você tem loja física?"]), slotsLivres: SLOTS, agora: AGORA });
  assert.deepEqual(o.mensagens, ["E a empresa tem CNPJ ativo?"]);
  // faturamento só como resposta à pergunta (texto de meta em outro momento não vira faturamento)
  const meta = turnoJulia({ sessao: s, mensagem: "minha meta é faturar 100 mil", llm: null, slotsLivres: SLOTS, agora: AGORA });
  assert.equal(meta.sessao.faixa_faturamento, undefined);
});

test("Agenda: 12:15 e 18:30, dias úteis, pula passados e ocupados; escolha por hora, posição ou dia", () => {
  assert.deepEqual(SLOTS.map((x) => x.label), ["hoje às 12h15", "hoje às 18h30"]);
  const sexta18h = deBRT(2026, 11, 27, 18, 0);
  assert.deepEqual(gerarSlotsLigacao({ agora: sexta18h, horarios: [[12, 15], [18, 30]] }).map((x) => x.label), ["segunda (30/11) às 12h15", "segunda (30/11) às 18h30"]);
  const ocupado = { start: SLOTS[0].inicio.getTime(), end: SLOTS[0].fim.getTime() };
  assert.equal(gerarSlotsLigacao({ agora: AGORA, ocupados: [ocupado], horarios: [[12, 15], [18, 30]] })[0].label, "hoje às 18h30");
  const of = SLOTS.map((x) => x.iso);
  assert.equal(escolherSlot("12:15", of, AGORA), of[0]);
  assert.equal(escolherSlot("prefiro 18h30", of, AGORA), of[1]);
  assert.equal(escolherSlot("o segundo", of, AGORA), of[1]);
  assert.equal(escolherSlot("meio dia", of, AGORA), of[0]);
  assert.equal(escolherSlot("tanto faz", of, AGORA), null);
});

test("Faixas de faturamento: número, texto e valor", () => {
  assert.equal(lerFaixa("2"), 2); assert.equal(lerFaixa("uns 30 mil"), 2); assert.equal(lerFaixa("acima de 100 mil"), 4);
  assert.equal(lerFaixa("prefiro não dizer"), 0); assert.equal(lerFaixa("ainda não faturo"), 1);
});

test("Troca de horário depois da passagem → 2 próximos livres; escolheu → remarca", () => {
  const s: SDRSession = { ...SDR_EMPTY_SESSION, status: "handoff_enviado", etapa: "ligacao_marcada", horario_reuniao: SLOTS[0].iso };
  const amanha = gerarSlotsLigacao({ agora: AGORA, quantidade: 3, horarios: [[12, 15], [18, 30]] });
  const o = turnoPosPassagem({ sessao: s, mensagem: "não vou conseguir nesse horário, pode remarcar?", slotsLivres: amanha, agora: AGORA });
  assert.equal(o.acao, "oferecer_novos_horarios");
  assert.ok(!o.sessao.slots_oferecidos!.includes(SLOTS[0].iso), "não oferece o horário que já era dele");
  const r = turnoPosPassagem({ sessao: o.sessao, mensagem: "18h30", slotsLivres: amanha, agora: AGORA });
  assert.equal(r.acao, "remarcar");
});

// ── Persona "Pedro" (pedido do dono em 25/11: até o nome "Avanteza" valer no WhatsApp, a SDR se apresenta como Pedro) ──
import * as R from "@/lib/ai/sdr/julia/roteiro";
import { aplicarPersona, roteiroDa, personaAtual, proibidoDaPersona, _definirPersona } from "@/lib/ai/sdr/julia/persona";
import { mensagemDeTransferencia } from "@/lib/ai/sdr/humano";

function todosOsTextosFixos(): string[] {
  const h1 = "hoje às 12h15", h2 = "amanhã às 18h30";
  return [
    ...Object.values(R.ABERTURAS).flat(), R.PERGUNTA_LOJA, R.PERGUNTA_CNPJ, R.PERGUNTA_FATURAMENTO,
    ...R.textosQualificado("Ana", h1, h2), ...R.textosNovosHorarios(h1, h2), ...R.textosNovosHorarios(h1, null),
    ...R.textosConfirmacao(h1, true), ...R.textosMorno("Ana"), ...R.textosFora("Ana"), R.TEXTO_RECEBI_FOTO,
    R.TEXTO_RESPOSTA_AUTOMATICA, R.TEXTO_OPT_OUT, R.textoFollowup1("Ana"), R.textoFollowup1Qualificado("Ana", h1, h2),
    R.textoFollowup1Qualificado("Ana", h1, null), R.TEXTO_FOLLOWUP_2, R.textoLembreteLead("Ana", "12h15"),
    ...R.textosSemHorario("Ana"), ...R.textosHorarioOcupado(h1, h2), ...R.textosHorarioOcupado(h1, null),
    mensagemDeTransferencia("frustrado", "Ana"), mensagemDeTransferencia("pediu_humano" as never, "Ana"),
  ];
}

test("persona Pedro: nenhum texto fixo cita a Júlia nem fala do Pedro na 3ª pessoa", () => {
  const saida = todosOsTextosFixos().map((t) => aplicarPersona(t, "pedro"));
  for (const t of saida) {
    assert.ok(!/j[uú]lia/i.test(t), `cita Júlia: ${t}`);
    assert.ok(!/\bo pedro\b|\bpro pedro\b|\bele (pode|te|já)\b/i.test(t.replace("Aqui é o Pedro", "")), `Pedro na 3ª pessoa: ${t}`);
    assert.ok(!/obrigada/i.test(t), `feminino: ${t}`);
    assert.ok(!R.PROIBIDO_SEMPRE.test(t), `Nexo/600: ${t}`);
  }
  assert.equal(aplicarPersona(R.ABERTURAS.tenho_loja[0], "pedro"), "Oi! Aqui é o Pedro, da Avanteza 👋");
  assert.deepEqual(R.textosConfirmacao("hoje às 18h30", false).map((t) => aplicarPersona(t, "pedro")).slice(0, 2), [
    "Fechado: hoje às 18h30. Te ligo do (62) 98446-5388.",
    "Pra ligação render: me manda foto de 3 produtos que mais vendem, com o preço de venda. Já levo a conta de quanto sobra em cada marketplace.",
  ]);
  if (process.env.JULIA_MOSTRAR) console.log(`\n── Persona Pedro (textos fixos) ──\n${saida.map((t) => `  ${t}`).join("\n")}\n`);
});

test("persona Júlia: textos ficam como estão", () => {
  for (const t of todosOsTextosFixos()) assert.equal(aplicarPersona(t, "julia"), t);
});

test("persona Pedro: roteiro do modelo se apresenta como Pedro e é honesto sobre o assistente virtual", () => {
  const r = roteiroDa("pedro");
  assert.match(r, /^Você é o Pedro, fundador da Avanteza/);
  assert.match(r, /assistente virtual/);
  const semAsRegras = r.replace(/Nunca use o nome "Júlia"\.|Usar o nome "Júlia"/g, "");
  assert.ok(!/j[uú]lia/i.test(semAsRegras), "roteiro do Pedro cita a Júlia");
  assert.ok(!/\bo Pedro te\b|com o Pedro, fundador/.test(r));
  assert.ok(!R.PROIBIDO_SEMPRE.test(r.replace(/Nunca diga "Nexo"|Dizer "Nexo"|"600 marcas"/g, "")));
  assert.equal(roteiroDa("julia"), ROTEIRO_JULIA);
});

test("filtro do modelo segue a persona", () => {
  assert.deepEqual(limparMensagensDoModelo([{ text: "Sou a Júlia 🙂" }, { text: "Aqui é o Pedro" }], "pedro"), ["Aqui é o Pedro"]);
  assert.deepEqual(limparMensagensDoModelo([{ text: "Sou a Júlia 🙂" }, { text: "Aqui é o Pedro" }], "julia"), ["Sou a Júlia 🙂"]);
  assert.ok(proibidoDaPersona("pedro").test("a Júlia te ajuda"));
});

test("persona padrão é Pedro até o nome valer; SDR_PERSONA força", () => {
  _definirPersona(null);
  const antes = process.env.SDR_PERSONA;
  delete process.env.SDR_PERSONA;
  assert.equal(personaAtual(), "pedro");
  _definirPersona("julia");
  assert.equal(personaAtual(), "julia");
  process.env.SDR_PERSONA = "pedro";
  assert.equal(personaAtual(), "pedro");
  if (antes === undefined) delete process.env.SDR_PERSONA; else process.env.SDR_PERSONA = antes;
  _definirPersona(null);
});
