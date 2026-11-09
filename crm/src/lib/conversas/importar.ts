// Grava mensagens de uma conversa do WhatsApp no contato certo e manda o trecho novo para o agente de combinados.
// Vêm do Vendedor IA (sozinhas, aos poucos: o agente lê quando a conversa esfria) ou de arquivo exportado (na hora).
// Gravar a mesma conversa de novo não duplica (hash por mensagem).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { normalizarTelefone } from "@/lib/integracao/vendedor-ia";
import { registrarFonte } from "@/lib/combinados/fontes";

export const MAX_MENSAGENS = 2000;
const CONTEXTO_ANTERIOR = 10; // mensagens já importadas que vão junto, para o agente entender o trecho novo
/** Conversa do Vendedor IA parada há este tempo é lida pelo agente (antes disso, ainda pode vir mais). */
export const CONVERSA_OCIOSA_MS = 30 * 60_000;

export interface MensagemEntrada { autor: string; deMim: boolean; texto: string; em: string | Date }
export interface Importacao {
  /** Um dos dois: contato já conhecido (tela do CRM, Vendedor IA) ou telefone. */
  contatoId?: string | null;
  telefone?: string | null;
  /** Nome do contato no WhatsApp: usado para criar o contato se o telefone não existir no CRM. */
  nome?: string | null;
  mensagens: MensagemEntrada[];
  origem: "ARQUIVO" | "VENDEDOR_IA";
}

export function validarMensagens(v: unknown): MensagemEntrada[] {
  if (!Array.isArray(v) || v.length === 0) throw new ErroEntrada("Nenhuma mensagem para importar");
  if (v.length > MAX_MENSAGENS) throw new ErroEntrada(`No máximo ${MAX_MENSAGENS} mensagens por vez`);
  return v.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const texto = String(o.texto ?? "").trim().slice(0, 10_000);
    const autor = String(o.autor ?? "").trim().slice(0, 120) || (o.deMim ? "Eu" : "Contato");
    const em = new Date(String(o.em ?? ""));
    if (!texto) throw new ErroEntrada(`Mensagem ${i + 1} sem texto`);
    if (Number.isNaN(em.getTime())) throw new ErroEntrada(`Mensagem ${i + 1} sem data válida`);
    return { autor, deMim: o.deMim === true, texto, em };
  });
}

/**
 * Oportunidade a que a conversa (ou reunião) do contato se refere. Por situação: em andamento; senão ganha com entrega
 * em andamento; senão a mais recente. Em cada situação, primeiro a em que ele é o contato da oportunidade, depois a
 * da empresa dele (duas oportunidades da mesma empresa: vale a da pessoa que falou).
 */
export async function oportunidadeDoContato(contatoId: string) {
  const vinculos = [{ pessoaId: contatoId }, { contatoId }, { contato: { pessoas: { some: { id: contatoId } } } }];
  const situacoes = [{ status: "EM_ANDAMENTO" }, { status: "GANHA", entrega: { status: "EM_ANDAMENTO" } }, {}];
  for (const situacao of situacoes) {
    for (const vinculo of vinculos) {
      const op = await prisma.oportunidade.findFirst({ where: { ...vinculo, ...situacao }, orderBy: { atualizadoEm: "desc" }, select: { id: true, nome: true } });
      if (op) return op;
    }
  }
  return null;
}

const fmt = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

type NovaMensagem = { contatoId: string; enviadaEm: Date; deMim: boolean; autor: string; texto: string; hash: string };

/** Manda um trecho de conversa ao agente, com as mensagens anteriores como contexto. */
async function analisarTrecho(contatoId: string, oportunidadeId: string, novas: NovaMensagem[], agendarAgente?: boolean) {
  novas.sort((a, b) => a.enviadaEm.getTime() - b.enviadaEm.getTime());
  const contexto = await prisma.mensagem.findMany({ where: { contatoId, enviadaEm: { lt: novas[0].enviadaEm } }, orderBy: { enviadaEm: "desc" }, take: CONTEXTO_ANTERIOR });
  const texto = [
    ...(contexto.length ? ["(mensagens anteriores, só para contexto)", ...contexto.reverse().map((m) => `[${fmt(m.enviadaEm)}] ${m.deMim ? "Consultor" : m.autor}: ${m.texto}`), "(mensagens novas)"] : []),
    ...novas.map((m) => `[${fmt(m.enviadaEm)}] ${m.deMim ? "Consultor" : m.autor}: ${m.texto}`),
  ].join("\n");
  return registrarFonte({ oportunidadeId, fonte: "CONVERSA", fonteRef: `${novas[0].hash.slice(0, 16)}:${novas.length}`, texto }, { agendar: agendarAgente });
}

export async function importarConversa(imp: Importacao, opcoes: { agendarAgente?: boolean } = {}) {
  const mensagens = imp.mensagens.map((m) => ({ ...m, em: m.em instanceof Date ? m.em : new Date(m.em) }));
  let contato = imp.contatoId ? await prisma.contato.findUnique({ where: { id: imp.contatoId } }) : null;
  if (imp.contatoId && !contato) throw new ErroEntrada("Contato não encontrado");
  let contatoCriado = false;
  if (!contato) {
    const telefone = normalizarTelefone(imp.telefone);
    if (!telefone) throw new ErroEntrada("Telefone do contato não identificado");
    contato = await prisma.contato.findFirst({ where: { telefone }, orderBy: [{ tipo: "desc" /* PESSOA antes de EMPRESA */ }, { criadoEm: "asc" }] });
    if (!contato) {
      contato = await prisma.contato.create({ data: { tipo: "PESSOA", nome: imp.nome?.trim().slice(0, 120) || `WhatsApp ${telefone.slice(-4)}`, telefone, origem: "WhatsApp (importado)" } });
      contatoCriado = true;
    }
  }
  const op = await oportunidadeDoContato(contato.id);
  // Do Vendedor IA chega aos poucos: o agente lê quando a conversa esfria (analisarConversasOciosas).
  const adiar = imp.origem === "VENDEDOR_IA";
  const agora = new Date();
  const linhas = mensagens.map((m) => ({
    contatoId: contato!.id, oportunidadeId: op?.id ?? null, canal: "WHATSAPP", autor: m.autor, deMim: m.deMim, texto: m.texto, enviadaEm: m.em, origem: imp.origem,
    hash: createHash("sha256").update(`${contato!.id}|${m.em.toISOString().slice(0, 16)}|${m.deMim ? 1 : 0}|${m.texto}`).digest("hex"),
    analisadaEm: adiar ? null : agora,
  }));
  const antes = new Set((await prisma.mensagem.findMany({ where: { hash: { in: linhas.map((l) => l.hash) } }, select: { hash: true } })).map((x) => x.hash));
  const novas = linhas.filter((l) => !antes.has(l.hash));
  if (novas.length) await prisma.mensagem.createMany({ data: novas, skipDuplicates: true });

  let analise = null;
  if (op && novas.length) {
    if (!adiar) analise = await analisarTrecho(contato.id, op.id, novas, opcoes.agendarAgente);
    const ultima = new Date(Math.max(...novas.map((m) => m.enviadaEm.getTime())));
    await prisma.oportunidade.updateMany({ where: { id: op.id, ultimaAtividadeEm: { lt: ultima } }, data: { ultimaAtividadeEm: ultima } });
  }
  return { contato: { id: contato.id, nome: contato.nome, criado: contatoCriado }, oportunidade: op, recebidas: linhas.length, novas: novas.length, analiseId: analise?.id ?? null };
}

/**
 * Conversas do Vendedor IA que pararam há 30 minutos: o trecho ainda não lido vai para o agente, uma análise por
 * contato. Sem oportunidade, só marca como lido. Seguro rodar em paralelo (cada mensagem é reivindicada).
 */
export async function analisarConversasOciosas(o: { agora?: Date; limite?: number; agendarAgente?: boolean } = {}) {
  const agora = o.agora ?? new Date();
  const pendentes = await prisma.mensagem.groupBy({ by: ["contatoId"], where: { origem: "VENDEDOR_IA", analisadaEm: null }, _max: { enviadaEm: true } });
  const ociosos = pendentes.filter((p) => p._max.enviadaEm && agora.getTime() - p._max.enviadaEm.getTime() >= CONVERSA_OCIOSA_MS).slice(0, o.limite ?? 10);
  let analises = 0;
  for (const p of ociosos) {
    const msgs = await prisma.mensagem.findMany({ where: { contatoId: p.contatoId, origem: "VENDEDOR_IA", analisadaEm: null }, orderBy: { enviadaEm: "asc" }, take: 500 });
    const claim = await prisma.mensagem.updateMany({ where: { id: { in: msgs.map((m) => m.id) }, analisadaEm: null }, data: { analisadaEm: agora } });
    if (claim.count !== msgs.length || !msgs.length) continue; // outra rodada pegou
    const op = await oportunidadeDoContato(p.contatoId);
    if (!op) continue;
    await analisarTrecho(p.contatoId, op.id, msgs, o.agendarAgente);
    analises++;
  }
  return { analises };
}

/** Contato do lead: pela chave do Vendedor IA (contato ou oportunidade); o telefone só confirma, nunca cria. */
export async function contatoDoLead(leadId: string, telefone: string | null) {
  const porChave = await prisma.contato.findUnique({ where: { vendedorIaLeadId: leadId }, select: { id: true } });
  if (porChave) return porChave.id;
  const op = await prisma.oportunidade.findFirst({ where: { vendedorIaLeadId: leadId }, orderBy: { criadoEm: "desc" }, select: { contatoId: true, pessoaId: true } });
  if (op) return op.pessoaId ?? op.contatoId;
  if (!telefone) return null;
  // Telefone de um contato que já tem negócio no CRM também vale (lead que chegou antes da integração).
  const c = await prisma.contato.findFirst({ where: { telefone, OR: [{ oportunidades: { some: {} } }, { comoPessoaEm: { some: {} } }] }, select: { id: true } });
  return c?.id ?? null;
}
