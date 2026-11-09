// Importa mensagens de uma conversa (extensão do WhatsApp Web ou arquivo exportado) para o contato certo e manda
// o trecho novo para o agente de combinados. Importar a mesma conversa de novo não duplica (hash por mensagem).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { normalizarTelefone } from "@/lib/integracao/vendedor-ia";
import { registrarFonte } from "@/lib/combinados/fontes";

export const MAX_MENSAGENS = 2000;
const CONTEXTO_ANTERIOR = 10; // mensagens já importadas que vão junto, para o agente entender o trecho novo

export interface MensagemEntrada { autor: string; deMim: boolean; texto: string; em: string | Date }
export interface Importacao {
  /** Um dos dois: contato já conhecido (tela do CRM) ou telefone (extensão). */
  contatoId?: string | null;
  telefone?: string | null;
  /** Nome do contato no WhatsApp: usado para criar o contato se o telefone não existir no CRM. */
  nome?: string | null;
  mensagens: MensagemEntrada[];
  origem: "EXTENSAO" | "ARQUIVO";
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
  const linhas = mensagens.map((m) => ({
    contatoId: contato!.id, oportunidadeId: op?.id ?? null, canal: "WHATSAPP", autor: m.autor, deMim: m.deMim, texto: m.texto, enviadaEm: m.em, origem: imp.origem,
    hash: createHash("sha256").update(`${contato!.id}|${m.em.toISOString().slice(0, 16)}|${m.deMim ? 1 : 0}|${m.texto}`).digest("hex"),
  }));
  const antes = new Set((await prisma.mensagem.findMany({ where: { hash: { in: linhas.map((l) => l.hash) } }, select: { hash: true } })).map((x) => x.hash));
  const novas = linhas.filter((l) => !antes.has(l.hash));
  if (novas.length) await prisma.mensagem.createMany({ data: novas, skipDuplicates: true });

  let analise = null;
  if (op && novas.length) {
    novas.sort((a, b) => a.enviadaEm.getTime() - b.enviadaEm.getTime());
    const contexto = await prisma.mensagem.findMany({ where: { contatoId: contato.id, enviadaEm: { lt: novas[0].enviadaEm } }, orderBy: { enviadaEm: "desc" }, take: CONTEXTO_ANTERIOR });
    const texto = [
      ...(contexto.length ? ["(mensagens anteriores, só para contexto)", ...contexto.reverse().map((m) => `[${fmt(m.enviadaEm)}] ${m.deMim ? "Consultor" : m.autor}: ${m.texto}`), "(mensagens novas)"] : []),
      ...novas.map((m) => `[${fmt(m.enviadaEm)}] ${m.deMim ? "Consultor" : m.autor}: ${m.texto}`),
    ].join("\n");
    analise = await registrarFonte({ oportunidadeId: op.id, fonte: "CONVERSA", fonteRef: `${novas[0].hash.slice(0, 16)}:${novas.length}`, texto }, { agendar: opcoes.agendarAgente });
    await prisma.oportunidade.update({ where: { id: op.id }, data: { ultimaAtividadeEm: new Date() } });
  }
  return { contato: { id: contato.id, nome: contato.nome, criado: contatoCriado }, oportunidade: op, recebidas: linhas.length, novas: novas.length, analiseId: analise?.id ?? null };
}
