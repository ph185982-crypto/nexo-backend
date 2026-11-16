import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { quadroEntregas } from "@/lib/entrega/quadro";
import { PILARES } from "@/lib/entrega/constantes";
import { escolha } from "@/lib/validar";

export const dynamic = "force-dynamic";

/** Quadro: entregas + cartões por coluna/pilar. Filtros: status, entregaId, contatoId, q, responsavelId ("sem" = sem dono), pilar, atrasados=1. */
export const GET = (req: Request) => comChaveAvanteza(req, async () => {
  const p = new URL(req.url).searchParams;
  const pilar = p.get("pilar");
  return Response.json(await quadroEntregas({
    status: p.get("status"), entregaId: p.get("entregaId"), contatoId: p.get("contatoId"), q: p.get("q")?.slice(0, 100), responsavelId: p.get("responsavelId"),
    pilar: pilar ? escolha(pilar, "pilar", PILARES) : null, atrasados: p.get("atrasados") === "1",
  }));
});
