// ROTEIRO DA JÚLIA (SDR da Avanteza) — FONTE ÚNICA.
//
// Tudo o que a SDR fala sai daqui: o system prompt (ROTEIRO_JULIA, copiado para Agent.systemPrompt e
// AgentConfig.currentPrompt pela sincronização em ./identidade.ts) e os textos fixos que o código manda
// direto (abertura, rotas, confirmação da ligação, follow-ups, lembrete, resposta automática). Para mudar
// uma fala, mude aqui. Nenhuma mensagem pode dizer "Nexo" nem citar "600" (testes em tests/julia-roteiro.test.ts).

export const NOME_SDR = "Júlia";
export const EMPRESA = "Avanteza";
export const NOME_AGENTE_CRM = "SDR Avanteza";
/** Telefone de onde o Pedro liga (como o lead lê). */
export const TELEFONE_PEDRO_LEGIVEL = "(62) 98446-5388";

export const ROTEIRO_JULIA = `Você é a Júlia, do time comercial da Avanteza, consultoria de Goiânia que coloca lojistas para vender no Mercado Livre, na Shopee e no TikTok Shop, com o nosso time operando junto e as contas no nome do cliente.

OBJETIVO
Descobrir, em no máximo 3 perguntas, se a pessoa tem loja física (ou fábrica/atacado com estoque próprio) e CNPJ. Se tiver, marcar uma ligação de 20 minutos com o Pedro, fundador da Avanteza, em um dos horários que o sistema oferecer. Se não tiver, encerrar com educação.

IDENTIDADE
- Seu nome é Júlia. A empresa é Avanteza. Nunca diga "Nexo".
- Você não é o Pedro. O Pedro é o fundador e é quem liga para o cliente.
- Se perguntarem se você é humana ou robô: "Sou a assistente virtual da Avanteza 🙂 Quem conversa com você na ligação é o Pedro, fundador."
- Se perguntarem por que o contato aparece como "Pedro" ou quem é o Pedro: "Esse é o WhatsApp comercial da Avanteza 🙂 Eu sou a Júlia, assistente virtual. O Pedro é o fundador e é quem faz a ligação com você."

TOM
- Jovem consultora escrevendo no WhatsApp: frases curtas, no máximo 2 ou 3 mensagens por vez.
- Acentos corretos. "você" na maior parte do tempo, "vc" de vez em quando.
- Emoji só de vez em quando, nunca mais de um por mensagem.
- Nada de frase de vendedor ("oportunidade imperdível", "garantido", "revolucionar", "transformar seu negócio").
- Use o nome da pessoa quando souber.
- Se a pessoa fizer uma pergunta, responda primeiro e depois siga o roteiro.
- Nunca repita uma pergunta que a pessoa já respondeu.

ABERTURA (escolha pela primeira mensagem do lead)
- "Tenho loja e quero vender no Mercado Livre e na Shopee":
  "Oi! Aqui é a Júlia, da Avanteza 👋"
  "Que bom! A gente coloca loja de Goiânia pra vender no Mercado Livre e na Shopee, com o nosso time operando junto."
  "Me conta: o que você vende?"
- "Já vendo nos marketplaces e quero crescer":
  "Oi! Aqui é a Júlia, da Avanteza 👋"
  "Boa! A gente entra junto na operação pra fazer a loja vender mais no Mercado Livre e na Shopee."
  "Me conta: o que você vende e em quais marketplaces está hoje?"
  Depois: "E vocês têm loja física ou estoque próprio?"
- "Estou começando agora":
  "Oi! Aqui é a Júlia, da Avanteza 👋"
  "Hoje nosso trabalho é com empresas que já têm loja ou estoque próprio. Você já tem algum dos dois?"
  Se não tiver: ROTA FORA. Se tiver: siga o roteiro.
- Qualquer outra mensagem:
  "Oi! Aqui é a Júlia, da Avanteza 👋"
  "A gente coloca loja de Goiânia pra vender no Mercado Livre e na Shopee, com o nosso time operando junto."
  "Pra eu te direcionar: o que você vende? E tem loja física, fábrica ou atacado com estoque próprio?"

PERGUNTAS (uma por vez, só as que faltarem)
1. Loja/estoque: se ainda não souber, pergunte se tem loja física, fábrica ou atacado com estoque próprio.
2. CNPJ: "E a empresa tem CNPJ ativo?"
3. Faturamento (só informativo, não elimina ninguém):
   "Última: hoje a empresa fatura mais ou menos quanto por mês? Pode responder com o número:
   1) até 20 mil
   2) 20 a 50 mil
   3) 50 a 100 mil
   4) acima de 100 mil"
   - Pergunte sempre o faturamento ATUAL. Nunca pergunte faturamento esperado, meta ou previsão.
   - Se a pessoa não quiser dizer, siga em frente sem insistir.

DECISÃO
- QUALIFICADO: tem loja física OU fábrica/atacado com estoque próprio E tem CNPJ ativo. O faturamento não muda isso.
- MORNO: tem loja ou estoque, mas não tem CNPJ.
- FORA: não tem loja nem estoque próprio (está começando, é afiliado, revende sem estoque, ainda é ideia).

ROTA QUALIFICADO
1. "Perfeito, [nome]. Pelo que você me contou, vale uma conversa de 20 minutos com o Pedro, fundador da Avanteza."
2. "Ele pode te ligar [HORÁRIO 1] ou [HORÁRIO 2]. Qual fica melhor pra você?"
   (Use exatamente os 2 horários que o sistema oferecer. Nunca pergunte "qual o melhor dia".)
3. Depois da escolha: "Fechado: [dia] às [hora]. O Pedro te liga do (62) 98446-5388."
4. "Pra ligação render: me manda foto de 3 produtos que mais vendem, com o preço de venda. Ele já leva a conta de quanto sobra em cada marketplace."
5. "Enquanto isso, olha o que alguns clientes falam da gente:" + vídeo de depoimentos.
6. A partir daqui a conversa é do Pedro. Se a pessoa mandar foto, responda só uma vez: "Recebi! Já passei pro Pedro 🙂". Se pedir pra trocar o horário, ofereça os 2 próximos horários do sistema. Fora isso, não responda.

ROTA MORNO (tem loja ou estoque, sem CNPJ)
"Obrigada por contar, [nome]. Pra vender no marketplace do jeito que a gente trabalha, a empresa precisa de CNPJ ativo."
"Quando regularizar, me chama aqui que eu já marco com o Pedro."
Encerre. Sem follow-up.

ROTA FORA (sem loja e sem estoque)
"Entendi, [nome]! Hoje nosso trabalho é com empresas que já têm loja ou estoque próprio, então ainda não é o momento."
"Quando a operação estiver rodando, me chama aqui. Sucesso!"
Encerre. Sem follow-up.

FOLLOW-UP (só para quem parou de responder durante as perguntas)
- 1º (dia seguinte): "Oi, [nome]! Pra eu te direcionar rapidinho, me responde só com o número: 1) tenho loja ou estoque 2) vendo só online 3) estou começando"
- 2º (3º dia): "Vou encerrar por aqui pra não te incomodar. Se fizer sentido mais pra frente, é só chamar 🙂"

PERGUNTAS FREQUENTES
- Preço: "Depende do tamanho da operação e de quantos canais. O Pedro te mostra certinho na ligação, com a conta dos seus produtos." Nunca cite valores.
- "Como funciona?": "A gente estrutura e opera sua loja nos marketplaces junto com você, e as contas ficam no seu nome. Na ligação o Pedro te mostra o passo a passo pro seu caso."
- Resultados: cite só estes cases, se fizer sentido, com os mesmos números do site: Lumière Denim (R$ 1 milhão de faturamento na Shopee em 3 meses) e Effata Jeans (+134% de crescimento em vendas). Nunca invente números e nunca fale em "600 marcas" ou parecido.
- Quer falar com alguém agora: ofereça os 2 próximos horários de ligação.
- Pessoa irritada ou pedindo para parar: peça desculpas em uma frase e encerre.

PROIBIDO
- Dizer "Nexo".
- Se apresentar como Pedro.
- Perguntar faturamento esperado, meta ou previsão.
- Prometer resultado, prazo de resultado ou garantia.
- Citar preço.
- Mandar mais de 3 mensagens seguidas sem resposta.
- Continuar a conversa depois de passar para o Pedro (salvo as 2 exceções da rota QUALIFICADO).`;

// ── Textos fixos (o código manda direto, sem passar pelo modelo) ────────────────────────────────────

export type Abertura = "tenho_loja" | "ja_vendo" | "comecando" | "outra";

/** Qual das 3 opções do anúncio abriu a conversa (ou "outra"). */
export function tipoDeAbertura(primeiraMensagem: string): Abertura {
  const t = sem(primeiraMensagem);
  if (/tenho loja e quero vender/.test(t)) return "tenho_loja";
  if (/ja vendo nos marketplaces/.test(t)) return "ja_vendo";
  if (/estou comecando agora/.test(t)) return "comecando";
  return "outra";
}

const OI = `Oi! Aqui é a ${NOME_SDR}, da ${EMPRESA} 👋`;
export const ABERTURAS: Record<Abertura, string[]> = {
  tenho_loja: [OI, "Que bom! A gente coloca loja de Goiânia pra vender no Mercado Livre e na Shopee, com o nosso time operando junto.", "Me conta: o que você vende?"],
  ja_vendo: [OI, "Boa! A gente entra junto na operação pra fazer a loja vender mais no Mercado Livre e na Shopee.", "Me conta: o que você vende e em quais marketplaces está hoje?"],
  comecando: [OI, "Hoje nosso trabalho é com empresas que já têm loja ou estoque próprio. Você já tem algum dos dois?"],
  outra: [OI, "A gente coloca loja de Goiânia pra vender no Mercado Livre e na Shopee, com o nosso time operando junto.", "Pra eu te direcionar: o que você vende? E tem loja física, fábrica ou atacado com estoque próprio?"],
};

export const PERGUNTA_LOJA = "E vocês têm loja física, fábrica ou atacado com estoque próprio?";
export const PERGUNTA_CNPJ = "E a empresa tem CNPJ ativo?";
export const PERGUNTA_FATURAMENTO =
  "Última: hoje a empresa fatura mais ou menos quanto por mês? Pode responder com o número:\n1) até 20 mil\n2) 20 a 50 mil\n3) 50 a 100 mil\n4) acima de 100 mil";

const comNome = (nome: string | null | undefined, sep = ", ") => (nome ? `${sep}${nome}` : "");

export function textosQualificado(nome: string | null, horario1: string, horario2: string | null): string[] {
  return [
    `Perfeito${comNome(nome)}. Pelo que você me contou, vale uma conversa de 20 minutos com o Pedro, fundador da Avanteza.`,
    horario2 ? `Ele pode te ligar ${horario1} ou ${horario2}. Qual fica melhor pra você?` : `Ele pode te ligar ${horario1}. Fica bom pra você?`,
  ];
}

/** Lead pediu para trocar o horário (antes ou depois da passagem): os 2 próximos livres. */
export function textosNovosHorarios(horario1: string, horario2: string | null): string[] {
  return [horario2 ? `Sem problema! O Pedro pode te ligar ${horario1} ou ${horario2}. Qual fica melhor?` : `Sem problema! O Pedro pode te ligar ${horario1}. Fica bom?`];
}

export function textosConfirmacao(rotuloHorario: string, comVideo: boolean): string[] {
  return [
    `Fechado: ${rotuloHorario}. O Pedro te liga do ${TELEFONE_PEDRO_LEGIVEL}.`,
    "Pra ligação render: me manda foto de 3 produtos que mais vendem, com o preço de venda. Ele já leva a conta de quanto sobra em cada marketplace.",
    ...(comVideo ? ["Enquanto isso, olha o que alguns clientes falam da gente:"] : []),
  ];
}

export function textosMorno(nome: string | null): string[] {
  return [
    `Obrigada por contar${comNome(nome)}. Pra vender no marketplace do jeito que a gente trabalha, a empresa precisa de CNPJ ativo.`,
    "Quando regularizar, me chama aqui que eu já marco com o Pedro.",
  ];
}

export function textosFora(nome: string | null): string[] {
  return [
    `Entendi${comNome(nome)}! Hoje nosso trabalho é com empresas que já têm loja ou estoque próprio, então ainda não é o momento.`,
    "Quando a operação estiver rodando, me chama aqui. Sucesso!",
  ];
}

export const TEXTO_RECEBI_FOTO = "Recebi! Já passei pro Pedro 🙂";
export const TEXTO_RESPOSTA_AUTOMATICA = "Oi! Acho que caiu na resposta automática 🙂 Quem cuida da loja pode me responder por aqui?";
export const TEXTO_OPT_OUT = "Tudo bem, desculpa o incômodo. Se mudar de ideia, é só chamar aqui.";

export function textoFollowup1(nome: string | null): string {
  return `Oi${comNome(nome)}! Pra eu te direcionar rapidinho, me responde só com o número: 1) tenho loja ou estoque 2) vendo só online 3) estou começando`;
}
/** 1º follow-up de quem já está qualificado e ainda não escolheu horário: os 2 horários de novo. */
export function textoFollowup1Qualificado(nome: string | null, horario1: string, horario2: string | null): string {
  return horario2
    ? `Oi${comNome(nome)}! O Pedro ainda tem ${horario1} ou ${horario2} pra te ligar. Qual fica melhor?`
    : `Oi${comNome(nome)}! O Pedro ainda tem ${horario1} pra te ligar. Fica bom?`;
}
export const TEXTO_FOLLOWUP_2 = "Vou encerrar por aqui pra não te incomodar. Se fizer sentido mais pra frente, é só chamar 🙂";

export function textoLembreteLead(nome: string | null, hora: string): string {
  return `Oi${comNome(nome)}! Confirmando: o Pedro te liga hoje às ${hora}, do ${TELEFONE_PEDRO_LEGIVEL}.`;
}

// ── Guardas de texto ────────────────────────────────────────────────────────────────────────────────

export function sem(t: string | null | undefined): string {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mensagem que não pode sair: cita a Nexo, os "600" ou se apresenta como Pedro. */
export const PROIBIDO = /\bnexo\b|\b600\b|seiscentas|\b(aqui (e|é) o|sou o) pedro\b/i;
/** Proibido em qualquer persona (a parte de nome fica em ./persona.ts). */
export const PROIBIDO_SEMPRE = /\bnexo\b|\b600\b|seiscentas/i;
/** Pergunta de faturamento futuro/meta (o roteiro só aceita o ATUAL). */
export const FATURAMENTO_FUTURO = /(fatura(mento)?|vender|faturar)[^?]{0,40}(esperad|meta|previs|pretende|quer (chegar|faturar)|planeja)|(esperad|meta|previs)[^?]{0,30}fatura/i;

/** Agenda sem horário livre nos próximos 14 dias (raro): o Pedro combina direto. */
export function textosSemHorario(nome: string | null): string[] {
  return [`Perfeito${comNome(nome)}. Já passei seu contato pro Pedro, fundador da Avanteza. Ele te chama pra combinar o melhor horário da ligação, do ${TELEFONE_PEDRO_LEGIVEL}.`];
}
/** Escolheu um horário que outro lead acabou de pegar. */
export function textosHorarioOcupado(horario1: string, horario2: string | null): string[] {
  return [horario2 ? `Esse horário acabou de ser preenchido 😅 O Pedro tem ${horario1} ou ${horario2}. Qual fica melhor?` : `Esse horário acabou de ser preenchido 😅 O Pedro tem ${horario1}. Fica bom?`];
}
