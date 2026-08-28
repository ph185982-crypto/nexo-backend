import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Garante que a URL de conexão tenha connection_limit e pool_timeout adequados,
// independente do que estiver no .env.  Com connection_limit=1 (padrão Supabase
// free) qualquer rajada de requisições simultâneas (webhook + Apollo + health)
// esgota o pool e derruba o CRM.  5 conexões por processo é seguro com pgbouncer
// em transaction mode: cada conexão Prisma → 1 slot pgbouncer → liberado após
// cada query.  pool_timeout=8 faz a query falhar rápido em vez de travar a fila.
function buildDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL not set");
  try {
    const url = new URL(base);
    url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? "5");
    url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "8");
    // pgbouncer=true já deve estar na URL, mas garante caso não esteja
    if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    return url.toString();
  } catch {
    // URL inválida (ex: env mal configurado) — usa o original sem modificar
    return base;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: buildDatabaseUrl() } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
