// Importação do histórico do app Contratos antigo (localStorage "nexo_history_v1", exportado pelo Cowork:
// docs/PROMPT_COWORK_EXPORTAR_CONTRATOS.md). Rodada por scripts/importar-contratos.mjs.
//
// Idempotente: um item já importado (mesmo envelopeId da ClickSign, ou o mesmo id do histórico, guardado em
// formJson._idOriginal) não é criado de novo; rodar duas vezes cria 0 na segunda.
// Regras:
//  - item com zsToken e provider "clicksign" → envelopeId = zsToken, status ENVIADO (o real vem com --clicksign);
//  - item com zsToken sem provider (ou "zapsign") → provedor "zapsign", só leitura, status ENVIADO, sem automação;
//  - item sem zsToken → GERADO (sem PDF: a ficha oferece "Gerar de novo" a partir do formulário);
//  - importados nunca disparam a automação do assinado (automatizadoEm já vem preenchido): esses clientes já
//    existem na operação; ganhar oportunidades antigas ou avisar a Central de novo duplicaria trabalho.
// Com --clicksign: consulta cada envelope importado (status real e PDF assinado) e cria IMPORTADO_CLICKSIGN para
// envelopes recentes (os 50 últimos) que não estejam em nenhum histórico.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import * as cs from "./clicksign";
import { camposDoForm, nomeArquivo, normalizarForm, statusDoEnvelope } from "./modelo";
import { aplicarStatus } from "./servico";

export interface ItemHistorico {
  id?: string; createdAt?: string; filename?: string; form?: unknown; replaces?: string | null;
  provider?: string; zsToken?: string; docId?: string; sentAt?: string; folder?: string;
}

export interface ResultadoImportacao { lidos: number; criados: number; existentes: number; ignorados: number; consultados: number; atualizados: number; daClickSign: number; erros: string[] }

const data = (s?: string) => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d : null; };

/** Aceita o arquivo do Cowork ({ itens: [...] }) ou a lista crua. */
export function lerArquivoHistorico(json: unknown): ItemHistorico[] {
  const itens = Array.isArray(json) ? json : (json as { itens?: unknown })?.itens;
  if (!Array.isArray(itens)) throw new Error("Arquivo sem lista de contratos (esperado { itens: [...] } ou uma lista)");
  return itens.filter((x): x is ItemHistorico => !!x && typeof x === "object");
}

async function porIdOriginal(id: string) {
  return prisma.contratoEmitido.findFirst({ where: { formJson: { path: ["_idOriginal"], equals: id } }, select: { id: true } });
}

export async function importarHistorico(itensBrutos: ItemHistorico[], o: { clicksign?: boolean; agora?: Date } = {}): Promise<ResultadoImportacao> {
  const agora = o.agora ?? new Date();
  const res: ResultadoImportacao = { lidos: itensBrutos.length, criados: 0, existentes: 0, ignorados: 0, consultados: 0, atualizados: 0, daClickSign: 0, erros: [] };
  // Mais antigos primeiro: a versão anterior ("replaces") já existe quando a nova entra.
  const itens = [...itensBrutos].sort((a, b) => (data(a.createdAt)?.getTime() ?? 0) - (data(b.createdAt)?.getTime() ?? 0));
  const importadosClickSign: string[] = [];

  for (const it of itens) {
    try {
      if (!it.id && !it.zsToken) { res.ignorados++; continue; }
      const clicksign = !!it.zsToken && it.provider === "clicksign";
      const provedor = it.zsToken && !clicksign ? "zapsign" : "clicksign";
      const ja = (clicksign ? await prisma.contratoEmitido.findUnique({ where: { envelopeId: it.zsToken! }, select: { id: true } }) : null)
        ?? (it.id ? await porIdOriginal(it.id) : null);
      if (ja) { res.existentes++; if (clicksign) importadosClickSign.push(it.zsToken!); continue; }

      const form = normalizarForm({ ...(it.form && typeof it.form === "object" ? it.form : {}), _idOriginal: it.id ?? `envelope:${it.zsToken}` });
      const substituiId = it.replaces ? (await porIdOriginal(it.replaces))?.id ?? null : null;
      const criado = await prisma.contratoEmitido.create({
        data: {
          ...camposDoForm(form), filename: it.filename || nomeArquivo(form), formJson: form as unknown as Prisma.InputJsonValue, substituiId,
          provedor, envelopeId: clicksign ? it.zsToken! : null, documentoId: clicksign ? it.docId ?? null : it.zsToken ?? null,
          pastaClicksign: it.folder ?? null, status: it.zsToken ? "ENVIADO" : "GERADO",
          enviadoEm: data(it.sentAt), criadoEm: data(it.createdAt) ?? agora, origem: "IMPORTADO_NAVEGADOR", automatizadoEm: agora,
          eventos: { create: { tipo: "IMPORTADO", payload: { idOriginal: it.id ?? null, provider: it.provider ?? null } } },
        },
      });
      res.criados++;
      if (clicksign) importadosClickSign.push(criado.envelopeId!);
    } catch (e) {
      res.erros.push(`${it.id ?? it.zsToken}: ${(e as Error).message}`);
    }
  }

  if (o.clicksign) {
    if (!cs.clickSignConfigurada()) { res.erros.push("--clicksign: CLICKSIGN_TOKEN não configurado; status reais não consultados"); return res; }
    // 1. Status real e PDF assinado dos envelopes do histórico.
    for (const envelopeId of importadosClickSign) {
      try {
        const c = await prisma.contratoEmitido.findUnique({ where: { envelopeId }, select: { id: true, status: true, documentoId: true } });
        if (!c) continue;
        res.consultados++;
        const est = await cs.consultarEnvelope(envelopeId);
        const doc = est.documentos.find((d) => d.id === c.documentoId) ?? est.documentos[0];
        if (!c.documentoId && doc) await prisma.contratoEmitido.update({ where: { id: c.id }, data: { documentoId: doc.id } });
        const novo = statusDoEnvelope(est.status, c.status);
        if (novo && novo !== c.status) res.atualizados++;
        if (novo) await aplicarStatus(c.id, novo, { urlAssinado: doc?.assinado ?? null });
      } catch (e) { res.erros.push(`envelope ${envelopeId}: ${(e as Error).message}`); }
    }
    // 2. Envelopes recentes que não estão em nenhum histórico.
    try {
      for (const e of await cs.listarEnvelopes(50)) {
        if (await prisma.contratoEmitido.findUnique({ where: { envelopeId: e.envelopeId }, select: { id: true } })) continue;
        const est = await cs.consultarEnvelope(e.envelopeId);
        const doc = est.documentos[0];
        const status = statusDoEnvelope(e.status, "ENVIADO") ?? "ENVIADO";
        const c = await prisma.contratoEmitido.create({
          data: {
            modelo: "desconhecido", razaoSocial: e.nome || "Envelope da ClickSign", filename: `${e.nome || e.envelopeId}.pdf`,
            formJson: { _idOriginal: `envelope:${e.envelopeId}` }, provedor: "clicksign", envelopeId: e.envelopeId, documentoId: doc?.id ?? null,
            status: status === "ASSINADO" ? "ENVIADO" : status, enviadoEm: data(e.criadoEm ?? undefined), criadoEm: data(e.criadoEm ?? undefined) ?? agora,
            origem: "IMPORTADO_CLICKSIGN", automatizadoEm: agora,
            eventos: { create: { tipo: "IMPORTADO", payload: { daClickSign: true, status: e.status } } },
          },
        });
        if (status === "ASSINADO") await aplicarStatus(c.id, "ASSINADO", { urlAssinado: doc?.assinado ?? null });
        res.daClickSign++;
      }
    } catch (e) { res.erros.push(`lista da ClickSign: ${(e as Error).message}`); }
  }
  return res;
}
