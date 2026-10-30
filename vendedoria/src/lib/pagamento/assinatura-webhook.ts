// Assinatura dos webhooks do Mercado Pago (header x-signature "ts=...,v1=...").
// Manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" assinado com
// HMAC-SHA256 pela chave secreta do webhook. Sem isso qualquer um podia
// disparar o fluxo de "pagamento aprovado" (a rota reconsultava o status na
// API do MP, o que limitava o dano, mas o endpoint ficava aberto a abuso).
import { createHmac, timingSafeEqual } from "crypto";

export interface EntradaAssinaturaMP {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}

export function validarAssinaturaMercadoPago(e: EntradaAssinaturaMP): boolean {
  if (!e.xSignature || !e.dataId || !e.secret) return false;
  const partes = Object.fromEntries(
    e.xSignature.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return i < 0 ? [kv.trim(), ""] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;
  // Regra do MP: id alfanumérico vai em minúsculas.
  const id = /^[a-z0-9]+$/i.test(e.dataId) ? e.dataId.toLowerCase() : e.dataId;
  const manifesto = `id:${id};request-id:${e.xRequestId ?? ""};ts:${ts};`;
  const esperado = createHmac("sha256", e.secret).update(manifesto).digest("hex");
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
