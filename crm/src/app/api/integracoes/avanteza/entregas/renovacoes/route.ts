import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { renovacoesProximas } from "@/lib/entrega/quadro";
import { ErroEntrada } from "@/lib/validar";

export const dynamic = "force-dynamic";

/** Renovações nos próximos N dias (padrão 60, máximo 365), incluindo as vencidas. */
export const GET = (req: Request) => comChaveAvanteza(req, async () => {
  const d = new URL(req.url).searchParams.get("dias");
  const dias = d === null ? 60 : Number(d);
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) throw new ErroEntrada("dias inválido");
  return Response.json({ renovacoes: await renovacoesProximas(dias) });
});
