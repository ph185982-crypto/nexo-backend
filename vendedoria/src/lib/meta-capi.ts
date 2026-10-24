// API de Conversões da Meta — Business Messaging (Click-to-WhatsApp).
//
// Avisa a Meta quando um lead que veio de anúncio vira "qualificado"
// (LeadSubmitted) ou "ganho" (Purchase). Formato conferido na documentação
// oficial (developers.facebook.com/docs/marketing-api/conversions-api/business-messaging):
//   POST https://graph.facebook.com/{versão}/{dataset}/events?access_token=…
//   corpo: { "data": [ { event_name, event_time, action_source: "business_messaging",
//            messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id, ctwa_clid },
//            custom_data? } ] }
//
// Segurança: o token só existe em process.env e na URL da chamada. Nunca é
// gravado (payload salvo é o corpo, sem token) nem logado — mensagens de erro
// passam por `limpar()` antes de ir para log ou banco.
//
// Idempotência: a Meta NÃO deduplica eventos desse canal, então a unicidade
// (leadId, eventName) da tabela MetaConversionEvent é a nossa deduplicação.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { eventoDaColuna, type EventoMeta } from "@/lib/crm/funil-config";

export type StatusEvento = "PENDING" | "SENT" | "FAILED" | "DRY_RUN" | "SKIPPED_NO_CONFIG";

/** Versão do Graph API usada quando META_GRAPH_VERSION não está definida. */
export const GRAPH_VERSION_PADRAO = "v25.0";
const VALOR_COMPRA_PADRAO = 2497;
const ESPERAS_PADRAO_MS = [500, 1_500]; // 3 tentativas: imediata, +0,5s, +1,5s
const TIMEOUT_MS = 8_000;

export interface ConfigCapi {
  token?: string;
  datasetId?: string;
  wabaId?: string;
  pageId?: string;
  graphVersion: string;
  testEventCode?: string;
  purchaseDefault: number;
  dryRun: boolean;
  /** page_id só é documentado para Messenger — por padrão NÃO vai no payload do WhatsApp. */
  enviarPageId: boolean;
}

export type EnvLike = Record<string, string | undefined>;

export function lerConfigCapi(env: EnvLike = process.env): ConfigCapi {
  const valor = Number(env.META_PURCHASE_DEFAULT_VALUE);
  return {
    token: env.META_CAPI_TOKEN || undefined,
    datasetId: env.META_DATASET_ID || undefined,
    wabaId: env.META_WABA_ID || undefined,
    pageId: env.META_PAGE_ID || undefined,
    graphVersion: env.META_GRAPH_VERSION || GRAPH_VERSION_PADRAO,
    testEventCode: env.META_TEST_EVENT_CODE || undefined,
    purchaseDefault: Number.isFinite(valor) && valor > 0 ? valor : VALOR_COMPRA_PADRAO,
    dryRun: env.META_CAPI_DRY_RUN === "true",
    enviarPageId: env.META_CAPI_SEND_PAGE_ID === "true",
  };
}

export interface LeadParaEvento {
  id: string;
  ctwaClid: string;
  valorContrato?: number | null;
}

export function eventIdDe(leadId: string, eventName: EventoMeta): string {
  return `${leadId}:${eventName}`;
}

/** Monta o corpo da requisição (sem o token). Função pura. */
export function montarCorpoEvento(
  cfg: ConfigCapi,
  lead: LeadParaEvento,
  eventName: EventoMeta,
  agoraMs: number = Date.now(),
): Record<string, unknown> {
  const userData: Record<string, unknown> = {
    whatsapp_business_account_id: cfg.wabaId,
    ctwa_clid: lead.ctwaClid,
  };
  if (cfg.enviarPageId && cfg.pageId) userData.page_id = cfg.pageId;

  const evento: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(agoraMs / 1000),
    event_id: eventIdDe(lead.id, eventName),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: userData,
  };
  if (eventName === "Purchase") {
    const valor = lead.valorContrato != null && lead.valorContrato > 0 ? lead.valorContrato : cfg.purchaseDefault;
    evento.custom_data = { currency: "BRL", value: valor };
  }

  const corpo: Record<string, unknown> = { data: [evento] };
  if (cfg.testEventCode) corpo.test_event_code = cfg.testEventCode;
  return corpo;
}

/** Remove o token de qualquer texto antes de logar/gravar. */
function limpar(texto: string, cfg: ConfigCapi): string {
  let t = texto;
  if (cfg.token) t = t.split(cfg.token).join("[token]");
  return t.replace(/access_token=[^&\s"']+/g, "access_token=[token]");
}

export interface OpcoesEnvio {
  fetchImpl?: typeof fetch;
  esperasMs?: number[];
  env?: EnvLike;
  /** true na rota de reenvio: reaproveita linhas FAILED / SKIPPED_NO_CONFIG / PENDING antigas. */
  reenviar?: boolean;
}

export type ResultadoEnvio =
  | { resultado: "IGNORADO"; motivo: string }
  | { resultado: "JA_REGISTRADO"; status: string }
  | { resultado: StatusEvento; httpStatus?: number; tentativas: number };

/**
 * Envia (ou registra) o evento de conversão de um lead.
 * Só vale para lead INBOUND com ctwa_clid. Nunca lança.
 */
export async function enviarEventoMeta(
  leadId: string,
  eventName: EventoMeta,
  opts: OpcoesEnvio = {},
): Promise<ResultadoEnvio> {
  try {
    const cfg = lerConfigCapi(opts.env);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, leadOrigin: true, ctwaClid: true, valorContrato: true },
    });
    if (!lead) return { resultado: "IGNORADO", motivo: "lead não encontrado" };
    if (lead.leadOrigin !== "INBOUND") return { resultado: "IGNORADO", motivo: "lead não é INBOUND" };
    if (!lead.ctwaClid) return { resultado: "IGNORADO", motivo: "lead sem ctwa_clid" };

    const eventId = eventIdDe(lead.id, eventName);

    // Reserva a linha. A unicidade (leadId, eventName) impede duplicar o evento.
    try {
      await prisma.metaConversionEvent.create({
        data: { leadId: lead.id, eventName, eventId, status: "PENDING" },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      const existente = await prisma.metaConversionEvent.findUnique({
        where: { leadId_eventName: { leadId: lead.id, eventName } },
      });
      const reaproveitavel = opts.reenviar && existente &&
        ["FAILED", "SKIPPED_NO_CONFIG", "PENDING"].includes(existente.status);
      if (!reaproveitavel) return { resultado: "JA_REGISTRADO", status: existente?.status ?? "?" };
      // Claim atômico: só um reenvio concorrente leva a linha.
      const claim = await prisma.metaConversionEvent.updateMany({
        where: { id: existente.id, status: existente.status, atualizadoEm: existente.atualizadoEm },
        data: { status: "PENDING" },
      });
      if (claim.count === 0) return { resultado: "JA_REGISTRADO", status: "em andamento" };
    }

    const corpo = montarCorpoEvento(cfg, { id: lead.id, ctwaClid: lead.ctwaClid, valorContrato: lead.valorContrato }, eventName);
    const salvar = (data: Prisma.MetaConversionEventUpdateInput) =>
      prisma.metaConversionEvent.update({
        where: { leadId_eventName: { leadId: lead.id, eventName } },
        data: { payload: corpo as Prisma.InputJsonValue, ...data },
      });

    if (cfg.dryRun) {
      await salvar({ status: "DRY_RUN", resposta: "META_CAPI_DRY_RUN=true — não enviado" });
      console.log(`[MetaCAPI] DRY_RUN | lead=${lead.id} | ${eventName}`);
      return { resultado: "DRY_RUN", tentativas: 0 };
    }

    if (!cfg.token || !cfg.datasetId || !cfg.wabaId) {
      await salvar({ status: "SKIPPED_NO_CONFIG", resposta: "Faltam META_CAPI_TOKEN, META_DATASET_ID ou META_WABA_ID" });
      console.warn(`[MetaCAPI] SKIPPED_NO_CONFIG | lead=${lead.id} | ${eventName}`);
      return { resultado: "SKIPPED_NO_CONFIG", tentativas: 0 };
    }

    const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.datasetId}/events?access_token=${encodeURIComponent(cfg.token)}`;
    const fetchFn = opts.fetchImpl ?? fetch;
    const esperas = opts.esperasMs ?? ESPERAS_PADRAO_MS;
    let ultimoStatus: number | undefined;
    let ultimaResposta = "";
    let tentativas = 0;

    for (let i = 0; i <= esperas.length; i++) {
      tentativas = i + 1;
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        ultimoStatus = res.status;
        ultimaResposta = limpar(await res.text().catch(() => ""), cfg).slice(0, 1_000);

        if (res.ok) {
          let recebidos: number | undefined;
          try { recebidos = (JSON.parse(ultimaResposta) as { events_received?: number }).events_received; } catch { /* corpo não-JSON */ }
          if (recebidos === 0) break; // 2xx mas a Meta não aceitou nenhum evento → falha
          await salvar({ status: "SENT", httpStatus: res.status, resposta: ultimaResposta, tentativas, sentAt: new Date() });
          console.log(`[MetaCAPI] SENT | lead=${lead.id} | ${eventName} | tentativa ${tentativas}`);
          return { resultado: "SENT", httpStatus: res.status, tentativas };
        }
        // 4xx (exceto 429) não melhora tentando de novo
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (e) {
        ultimaResposta = limpar(e instanceof Error ? e.message : String(e), cfg).slice(0, 1_000);
        ultimoStatus = undefined;
      }
      if (i < esperas.length) await new Promise((r) => setTimeout(r, esperas[i]));
    }

    await salvar({ status: "FAILED", httpStatus: ultimoStatus ?? null, resposta: ultimaResposta, tentativas });
    console.error(`[MetaCAPI] FAILED | lead=${lead.id} | ${eventName} | http=${ultimoStatus ?? "rede"}`);
    return { resultado: "FAILED", httpStatus: ultimoStatus, tentativas };
  } catch (e) {
    console.error(`[MetaCAPI] erro inesperado | lead=${leadId} | ${eventName}:`, e instanceof Error ? e.message : e);
    return { resultado: "IGNORADO", motivo: "erro interno" };
  }
}

/**
 * Ponto único chamado quando um lead muda de coluna (movimento automático e
 * arrastar no Kanban). Decide se a coluna corresponde a um evento e envia.
 */
export async function aoLeadMudarDeColuna(
  leadId: string,
  coluna: { type: string; name: string },
): Promise<void> {
  const evento = eventoDaColuna(coluna);
  if (!evento) return;
  await enviarEventoMeta(leadId, evento);
}
