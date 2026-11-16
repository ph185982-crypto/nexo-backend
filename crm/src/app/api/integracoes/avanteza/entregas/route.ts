// API de serviço da Central (Avanteza) para o funil de entrega. Contrato: crm/docs/integracao-avanteza.md.
// Autenticação: Authorization: Bearer <AVANTEZA_CRM_KEY>.
import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { listarEntregas } from "@/lib/entrega/servico";
import { STATUS_ENTREGA } from "@/lib/entrega/constantes";
import { escolha } from "@/lib/validar";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => comChaveAvanteza(req, async () => {
  const s = new URL(req.url).searchParams.get("status");
  return Response.json({ entregas: await listarEntregas(s ? escolha(s, "status", STATUS_ENTREGA) : null) });
});
