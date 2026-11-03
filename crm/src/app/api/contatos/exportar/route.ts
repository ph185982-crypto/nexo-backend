import { exigirAdmin } from "@/lib/auth/admin";
import { exportarCsv } from "@/lib/contatos/servico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exportar leva todos os dados pessoais: só administrador. */
export async function GET(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return new Response(await exportarCsv(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="contatos-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
