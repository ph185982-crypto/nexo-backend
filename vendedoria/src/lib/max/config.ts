import { prisma } from "@/lib/prisma/client";

export const MAX_OWNER_NUMBER = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

import { canonicalBrazilianNumber as canonicalBR } from "@/lib/whatsapp/send";

export function isMaxOwnerNumber(phone: string): boolean {
  return canonicalBR(phone) === canonicalBR(MAX_OWNER_NUMBER);
}

export const MAX_CHAT_MODEL = process.env.MAX_CHAT_MODEL ?? "gpt-4o-mini";
export const MAX_DEEP_MODEL = process.env.MAX_DEEP_MODEL ?? "gpt-4o";
export const MAX_TTS_MODEL = process.env.MAX_TTS_MODEL ?? "tts-1";
export const MAX_TTS_VOICE = process.env.MAX_TTS_VOICE ?? "onyx";
export const MAX_TOOL_ITERATIONS = 6;
export const MAX_TTS_CHAR_LIMIT = 900;
export const MAX_MEDIA_TIMEOUT_MS = 25_000;

export function getBrasiliaNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

export function getBrasiliaHour(): number {
  return getBrasiliaNow().getHours();
}

/** Partes Y/M/D do dia atual em Brasília (à prova de timezone do servidor). */
export function getBrasiliaDateParts(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * Data de hoje em Brasília como MEIA-NOITE UTC — segura para colunas @db.Date
 * (que truncam pelo componente UTC). Evita o bug de registrar no dia anterior.
 */
export function getBrasiliaDateOnly(): Date {
  const { y, m, d } = getBrasiliaDateParts();
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Mês (YYYY-MM) a partir dos componentes UTC — para datas @db.Date. */
export function formatMesUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

let _ownerProvider: { businessPhoneNumberId: string; organizationId: string; accessToken: string | null } | null = null;
let _ownerProviderAt = 0;

export async function getOwnerProvider() {
  const now = Date.now();
  if (_ownerProvider && now - _ownerProviderAt < 300_000) return _ownerProvider;
  const p = await prisma.whatsappProviderConfig.findFirst({
    where: { status: "CONNECTED" },
    select: { businessPhoneNumberId: true, organizationId: true, accessToken: true },
    orderBy: { createdAt: "asc" },
  });
  if (p) {
    _ownerProvider = p;
    _ownerProviderAt = now;
  }
  return _ownerProvider;
}

export function resolveToken(accessToken?: string | null): string {
  return accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? "";
}
