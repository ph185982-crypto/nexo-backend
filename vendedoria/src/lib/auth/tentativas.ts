// Limite de tentativas de login: 10 falhas por e-mail ou 30 por IP em 15 min
// bloqueiam novas tentativas até a janela passar. Antes não havia limite —
// um único usuário ADMIN com senha e nenhuma proteção contra força bruta.
import { prisma } from "@/lib/prisma/client";

export const JANELA_MS = 15 * 60 * 1000;
export const MAX_POR_EMAIL = 10;
export const MAX_POR_IP = 30;

const chaveEmail = (email: string) => `email:${email.trim().toLowerCase()}`;
const chaveIp = (ip: string | null) => (ip ? `ip:${ip}` : null);

export function ipDaRequisicao(req: Request | undefined): string | null {
  const xff = req?.headers?.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || req?.headers?.get("x-real-ip")?.trim() || "";
  return ip || null;
}

export async function loginBloqueado(email: string, ip: string | null, agora = new Date()): Promise<boolean> {
  const desde = new Date(agora.getTime() - JANELA_MS);
  const porEmail = await prisma.loginAttempt.count({ where: { chave: chaveEmail(email), criadoEm: { gte: desde } } });
  if (porEmail >= MAX_POR_EMAIL) return true;
  const ci = chaveIp(ip);
  if (!ci) return false;
  const porIp = await prisma.loginAttempt.count({ where: { chave: ci, criadoEm: { gte: desde } } });
  return porIp >= MAX_POR_IP;
}

export async function registrarFalhaLogin(email: string, ip: string | null): Promise<void> {
  const chaves = [chaveEmail(email), chaveIp(ip)].filter((c): c is string => Boolean(c));
  await prisma.loginAttempt.createMany({ data: chaves.map((chave) => ({ chave })) });
}

export async function limparFalhasLogin(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { chave: chaveEmail(email) } });
}

/** Limpeza oportunista: registros com mais de 1 dia não servem para nada. */
export async function limparTentativasAntigas(agora = new Date()): Promise<number> {
  const r = await prisma.loginAttempt.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - 24 * 60 * 60 * 1000) } } });
  return r.count;
}
