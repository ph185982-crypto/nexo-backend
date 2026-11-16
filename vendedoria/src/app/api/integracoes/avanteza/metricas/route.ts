// GET /api/integracoes/avanteza/metricas?from=YYYY-MM-DD&to=YYYY-MM-DD
// Somente leitura, só agregados. Autenticação própria: Authorization: Bearer <AVANTEZA_METRICS_KEY>.
// Sem a variável configurada responde 503; chave errada ou ausente, 401. Contrato em docs/integracao-avanteza.md.
import { NextRequest, NextResponse } from "next/server";
import { calcularMetricas, conferirChave, validarIntervalo } from "@/lib/integracoes/avanteza-metricas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const SEM_CACHE = { "Cache-Control": "no-store" };
const json = (corpo: unknown, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(corpo, { status, headers: { ...SEM_CACHE, ...extra } });

export async function GET(req: NextRequest) {
  const auth = conferirChave(req.headers.get("authorization"), process.env.AVANTEZA_METRICS_KEY);
  if (auth === "sem-chave-configurada") return json({ error: "integração não configurada" }, 503);
  if (auth !== "ok") return json({ error: "não autorizado" }, 401, { "WWW-Authenticate": 'Bearer realm="avanteza-metricas"' });

  const sp = req.nextUrl.searchParams;
  const v = validarIntervalo(sp.get("from"), sp.get("to"));
  if (!v.ok) return json({ error: v.erro }, 400);

  try {
    return json(await calcularMetricas(v.de, v.ate), 200);
  } catch (e) {
    console.error("[metricas-avanteza] falha:", e instanceof Error ? e.message : "erro");
    return json({ error: "falha ao calcular as métricas" }, 500);
  }
}
