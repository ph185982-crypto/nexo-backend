// Fila do agente: cada texto (feedback, trecho de conversa, transcrição) vira uma AnaliseAgente PENDENTE.
// Na requisição, a análise roda depois da resposta (a pessoa não espera o modelo); o cron pega o que sobrar.
import { prisma } from "@/lib/prisma";
import { depoisDaResposta } from "@/lib/segundo-plano";
import { processarAnalise } from "./agente";

export const FONTES = ["FEEDBACK", "CONVERSA", "REUNIAO", "TEXTO"] as const;
export type Fonte = (typeof FONTES)[number];
/** Texto curto demais não tem combinado (e gastaria uma chamada à toa). */
export const MIN_CARACTERES = 20;

/**
 * Registra um texto para o agente ler. A mesma fonte (oportunidade + tipo + referência) é lida uma vez só.
 * Devolve a análise (nova ou a que já existia) ou null se o texto é curto demais.
 */
export async function registrarFonte(f: { oportunidadeId: string; fonte: Fonte; fonteRef: string; texto: string }, opcoes: { agendar?: boolean } = {}) {
  const texto = f.texto.trim();
  if (texto.length < MIN_CARACTERES) return null;
  await prisma.analiseAgente.createMany({ data: [{ oportunidadeId: f.oportunidadeId, fonte: f.fonte, fonteRef: f.fonteRef, texto }], skipDuplicates: true });
  const a = (await prisma.analiseAgente.findUnique({ where: { oportunidadeId_fonte_fonteRef: { oportunidadeId: f.oportunidadeId, fonte: f.fonte, fonteRef: f.fonteRef } } }))!;
  if (a.status === "PENDENTE" && opcoes.agendar !== false) depoisDaResposta(() => processarAnalise(a.id));
  return a;
}

/** Volta para a fila uma análise que deu erro ou estava sem chave (botão "Tentar de novo"). */
export async function reprocessar(analiseId: string) {
  const r = await prisma.analiseAgente.updateMany({ where: { id: analiseId, status: { in: ["ERRO", "SEM_CHAVE"] } }, data: { status: "PENDENTE", erro: null } });
  if (r.count > 0) depoisDaResposta(() => processarAnalise(analiseId));
  return r.count > 0;
}

/** Cron e "Executar agora": processa o que ficou pendente (inclusive análise que travou no meio). */
export async function processarPendentes(limite = 5, agora: Date = new Date()): Promise<{ processadas: number; sugestoes: number }> {
  await prisma.analiseAgente.updateMany({ where: { status: "PROCESSANDO", criadoEm: { lt: new Date(agora.getTime() - 15 * 60_000) } }, data: { status: "PENDENTE" } });
  const pendentes = await prisma.analiseAgente.findMany({ where: { status: "PENDENTE" }, orderBy: { criadoEm: "asc" }, take: limite, select: { id: true } });
  let sugestoes = 0;
  for (const p of pendentes) sugestoes += await processarAnalise(p.id, agora);
  return { processadas: pendentes.length, sugestoes };
}
