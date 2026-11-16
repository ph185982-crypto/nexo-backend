import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { rodarRotinaDeEntregas } from "@/lib/comercial/entrega/rotina";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Executar agora" a rotina diária (idempotente): responsáveis, planejamento, conclusão e renovação 60 dias antes. */
export const POST = (req: Request) => comChaveAvanteza(req, async () => {
  const r = await rodarRotinaDeEntregas();
  return Response.json({ ...r, erros: r.erros.length });
});
