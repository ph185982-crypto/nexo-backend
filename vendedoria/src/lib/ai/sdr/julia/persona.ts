// Nome com que a SDR se apresenta ao lead.
//
// Pedido do dono (25/11/2026): enquanto o WhatsApp ainda aparece como "pedro" (o nome "Avanteza" está em análise na
// Meta), a SDR se apresenta como Pedro. Quando o nome novo for aprovado e o número registrado, vira a Júlia sozinha
// (marca "whatsapp-nome-registrado", gravada por registrarNumero() ou pela checagem diária do nome em
// src/lib/whatsapp/perfil-avanteza.ts). SDR_PERSONA=pedro|julia na Vercel força um dos dois.
//
// O roteiro continua com uma fonte só (./roteiro.ts, escrito para a Júlia); aqui ficam só as trocas de texto da
// versão Pedro, aplicadas na saída de cada mensagem e no prompt.
import { ROTEIRO_JULIA } from "./roteiro";

export type Persona = "julia" | "pedro";
export const MARCA_NOME_REGISTRADO = "whatsapp-nome-registrado";
const CACHE_MS = 5 * 60_000;

const G = globalThis as unknown as { __personaSdr?: { v: Persona; ate: number } };

function daVariavel(): Persona | null {
  const v = process.env.SDR_PERSONA?.trim().toLowerCase();
  return v === "pedro" || v === "julia" ? v : null;
}

/** Persona em uso (síncrono). Sem informação ainda, Pedro (o nome do WhatsApp ainda é "pedro"). */
export function personaAtual(): Persona {
  return daVariavel() ?? G.__personaSdr?.v ?? "pedro";
}

/** Lê do banco se o nome "Avanteza" já foi registrado (com cache de 5 min). */
export async function carregarPersona(): Promise<Persona> {
  const fixa = daVariavel();
  if (fixa) return fixa;
  if (G.__personaSdr && G.__personaSdr.ate > Date.now()) return G.__personaSdr.v;
  let v: Persona = G.__personaSdr?.v ?? "pedro";
  try {
    const { prisma } = await import("@/lib/prisma/client");
    v = (await prisma.alertaEnviadoMax.findUnique({ where: { chave: MARCA_NOME_REGISTRADO } })) ? "julia" : "pedro";
  } catch (e) {
    console.error("[SDR] Não consegui ler a persona; seguindo com", v, e instanceof Error ? e.message : e);
  }
  G.__personaSdr = { v, ate: Date.now() + CACHE_MS };
  return v;
}

/** Só para testes. */
export function _definirPersona(v: Persona | null): void {
  G.__personaSdr = v ? { v, ate: Date.now() + CACHE_MS } : undefined;
}

export const NOME_DA_PERSONA: Record<Persona, string> = { julia: "Júlia", pedro: "Pedro" };

// Trocas da versão Pedro (em ordem; as mais longas primeiro).
const TROCAS_PEDRO: Array<[RegExp, string]> = [
  [/Aqui é a Júlia, da Avanteza/g, "Aqui é o Pedro, da Avanteza"],
  [/vale uma conversa de 20 minutos com o Pedro, fundador da Avanteza\./g, "vale uma conversa rápida de 20 minutos por ligação."],
  [/Já passei seu contato pro Pedro, fundador da Avanteza\. Ele te chama pra combinar/g, "Vou te chamar pra combinar"],
  [/vou te passar direto pro Pedro — ele continua a conversa daqui/g, "a partir daqui eu sigo com você pessoalmente"],
  [/Vou te passar direto pro Pedro, ele continua a conversa com você pessoalmente/g, "A partir daqui eu sigo com você pessoalmente"],
  [/Vou te passar pro Pedro, ele continua daqui com você/g, "A partir daqui eu sigo com você pessoalmente"],
  [/Recebi! Já passei pro Pedro 🙂/g, "Recebi! Vou olhar antes da nossa ligação 🙂"],
  [/eu já marco com o Pedro/g, "eu já marco nossa ligação"],
  [/Na ligação o Pedro te mostra/g, "Na ligação eu te mostro"],
  [/O Pedro te mostra/g, "Te mostro"],
  [/O Pedro pode te ligar/g, "Posso te ligar"],
  [/Ele pode te ligar/g, "Posso te ligar"],
  [/O Pedro ainda tem/g, "Ainda tenho"],
  [/O Pedro te liga do/g, "Te ligo do"],
  [/o Pedro te liga/g, "te ligo"],
  [/O Pedro tem/g, "Tenho"],
  [/Ele já leva a conta/g, "Já levo a conta"],
  [/Obrigada por contar/g, "Obrigado por contar"],
];

/** Texto da Júlia → texto da persona em uso. */
export function aplicarPersona(texto: string, persona: Persona = personaAtual()): string {
  if (persona === "julia") return texto;
  let t = texto;
  for (const [de, para] of TROCAS_PEDRO) t = t.replace(de, para);
  return t;
}

const CABECALHO_PEDRO = `Você é o Pedro, fundador da Avanteza, consultoria de Goiânia que coloca lojistas para vender no Mercado Livre, na Shopee e no TikTok Shop, com o nosso time operando junto e as contas no nome do cliente. Você responde no WhatsApp comercial da Avanteza.

OBJETIVO
Descobrir, em no máximo 3 perguntas, se a pessoa tem loja física (ou fábrica/atacado com estoque próprio) e CNPJ. Se tiver, marcar uma ligação de 20 minutos com você, em um dos horários que o sistema oferecer. Se não tiver, encerrar com educação.

IDENTIDADE
- Seu nome é Pedro, fundador da Avanteza. Nunca diga "Nexo". Nunca use o nome "Júlia".
- Escreva no masculino ("obrigado", "animado").
- Fale da ligação na primeira pessoa: "te ligo", "posso te ligar", "te mostro na ligação".
- Se perguntarem se é humano ou robô, seja honesto: "Aqui no WhatsApp quem responde primeiro é meu assistente virtual 🙂 Na ligação sou eu mesmo, o Pedro."

`;

/** Roteiro (system prompt) da persona. */
export function roteiroDa(persona: Persona = personaAtual()): string {
  if (persona === "julia") return ROTEIRO_JULIA;
  const corpo = ROTEIRO_JULIA.slice(ROTEIRO_JULIA.indexOf("TOM\n"))
    .replace("Jovem consultora escrevendo no WhatsApp", "Consultor escrevendo no WhatsApp")
    .replace("A partir daqui a conversa é do Pedro.", "A partir daqui a conversa continua na ligação.")
    .replace("- Se apresentar como Pedro.", "- Usar o nome \"Júlia\" ou falar do Pedro na terceira pessoa.")
    .replace("Continuar a conversa depois de passar para o Pedro", "Continuar a conversa depois de marcar a ligação");
  return CABECALHO_PEDRO + aplicarPersona(corpo, "pedro");
}

/** O que a persona nunca pode dizer (além de Nexo/600). */
export function proibidoDaPersona(persona: Persona = personaAtual()): RegExp {
  return persona === "julia" ? /\b(aqui (e|é) o|sou o) pedro\b/i : /\bj[uú]lia\b|\bassistente virtual da avanteza\b/i;
}
