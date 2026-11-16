// Webhook da ClickSign (POST /api/webhooks/clicksign).
//
// Autenticidade (documentação oficial, "Segurança de webhooks"): a cada disparo a ClickSign calcula o HMAC SHA-256
// do corpo cru da requisição com o "HMAC SHA256 Secret" gerado no cadastro do webhook e envia no cabeçalho
//   Content-Hmac: sha256=<hex>
// Conferimos o corpo exatamente como chegou (sem reformatar o JSON), em tempo constante. Por segurança, também
// aceitamos o mesmo valor em x-clicksign-signature (nome citado no FAQ novo da ClickSign). Segredo:
// CLICKSIGN_WEBHOOK_SECRET; sem ele a rota responde 503 (nada é processado sem conferir a assinatura).
//
// Idempotência: o corpo não traz id de evento; o id externo é "clicksign:<sha256 do corpo>" (a ClickSign reenvia o
// mesmo corpo quando não recebe 2xx). Repetido → 200 sem efeito.
// Efeito: o status do contrato vem da própria ClickSign (consulta ao envelope); sem token, do nome do evento.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { clickSignConfigurada } from "./clicksign";
import { aplicarStatus, atualizarDaClickSign } from "./servico";

export const CABECALHOS_ASSINATURA = ["content-hmac", "x-clicksign-signature"] as const;

export function assinaturaEsperada(corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");
}

/** Confere "sha256=<hex>" (ou só "<hex>") contra o HMAC do corpo cru. */
export function assinaturaValida(corpo: string, cabecalho: string | null | undefined, segredo: string): boolean {
  if (!cabecalho) return false;
  const recebido = cabecalho.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recebido)) return false;
  const a = Buffer.from(assinaturaEsperada(corpo, segredo), "hex");
  const b = Buffer.from(recebido, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const ASSINADO = new Set(["close", "auto_close", "document_closed"]);
const CANCELADO = new Set(["cancel"]);
const RECUSADO = new Set(["refusal"]);
const ASSINATURA = new Set(["sign"]);
const CONSULTAR = new Set(["deadline", "update_deadline"]);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Ids que podem identificar o envelope/documento no corpo (v3: document.key = id do documento no envelope). */
function idsDoCorpo(b: Json): { envelopes: string[]; documentos: string[] } {
  const s = (v: unknown) => (typeof v === "string" && v ? [v] : []);
  const envelopes = [...s(b.envelope?.id), ...s(b.envelope?.key), ...s(b.envelope_id), ...s(b.document?.envelope_id), ...s(b.document?.envelope_key), ...s(b.event?.data?.envelope?.id)];
  const documentos = [...s(b.document?.key), ...s(b.document?.id), ...s(b.document_id), ...s(b.event?.data?.document?.key)];
  return { envelopes, documentos };
}

export interface ResultadoWebhook { status: number; corpo: Record<string, unknown> }

export async function processarWebhookClickSign(corpo: string, cabecalhos: Headers): Promise<ResultadoWebhook> {
  const segredo = process.env.CLICKSIGN_WEBHOOK_SECRET?.trim();
  if (!segredo) return { status: 503, corpo: { erro: "CLICKSIGN_WEBHOOK_SECRET não configurado" } };
  const assinatura = CABECALHOS_ASSINATURA.map((h) => cabecalhos.get(h)).find(Boolean);
  if (!assinaturaValida(corpo, assinatura, segredo)) return { status: 401, corpo: { erro: "Assinatura inválida" } };

  let b: Json;
  try { b = JSON.parse(corpo); } catch { return { status: 400, corpo: { erro: "JSON inválido" } }; }
  const nome = String(b.event?.name ?? cabecalhos.get("event") ?? "desconhecido").slice(0, 60);
  const { envelopes, documentos } = idsDoCorpo(b);
  const contrato = await prisma.contratoEmitido.findFirst({
    where: { provedor: "clicksign", OR: [...(envelopes.length ? [{ envelopeId: { in: envelopes } }] : []), ...(documentos.length ? [{ documentoId: { in: documentos } }, { envelopeId: { in: documentos } }] : [])] },
    select: { id: true, envelopeId: true, status: true },
  });

  const externo = `clicksign:${createHash("sha256").update(corpo, "utf8").digest("hex")}`;
  // createMany + skipDuplicates: o repetido não vira erro (nem log de erro do Prisma).
  const gravado = await prisma.contratoEvento.createMany({
    data: [{ contratoId: contrato?.id ?? null, envelopeId: contrato?.envelopeId ?? envelopes[0] ?? null, tipo: nome, eventoExternoId: externo, payload: b as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  if (gravado.count === 0) return { status: 200, corpo: { ok: true, repetido: true } };
  if (!contrato) return { status: 200, corpo: { ok: true, ignorado: "contrato não encontrado" } };

  // Status real pela API (cobre eventos fora de ordem); sem token ou com a API fora, pelo nome do evento.
  if (clickSignConfigurada() && (ASSINADO.has(nome) || CANCELADO.has(nome) || RECUSADO.has(nome) || CONSULTAR.has(nome) || ASSINATURA.has(nome))) {
    try {
      if (RECUSADO.has(nome) && contrato.status !== "ASSINADO") await aplicarStatus(contrato.id, "RECUSADO");
      const r = await atualizarDaClickSign(contrato.id);
      if (ASSINATURA.has(nome) && r.bruto === "running") await aplicarStatus(contrato.id, "ASSINADO_PARCIAL");
      return { status: 200, corpo: { ok: true, status: ASSINATURA.has(nome) && r.bruto === "running" ? "ASSINADO_PARCIAL" : r.status } };
    } catch (e) {
      console.error("[clicksign] consulta do envelope falhou; seguindo pelo evento:", (e as Error).message);
    }
  }
  if (ASSINADO.has(nome)) await aplicarStatus(contrato.id, "ASSINADO");
  else if (CANCELADO.has(nome)) await aplicarStatus(contrato.id, "CANCELADO");
  else if (RECUSADO.has(nome)) await aplicarStatus(contrato.id, "RECUSADO");
  else if (ASSINATURA.has(nome) && contrato.status === "ENVIADO") await aplicarStatus(contrato.id, "ASSINADO_PARCIAL");
  return { status: 200, corpo: { ok: true } };
}
