import { prisma } from "@/lib/prisma/client";

export const MAX_OWNER_NUMBER = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

function canonicalBR(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);
  if (n.length === 11 && n[2] === "9") n = n.slice(0, 2) + n.slice(3);
  return n;
}

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

export function formatMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
