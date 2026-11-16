import { listarEntregas } from "@/lib/comercial/entrega/servico";
import { STATUS_ENTREGA } from "@/lib/comercial/entrega/constantes";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada, escolha } from "@/lib/comercial/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return comEntrada(async () => {
    const s = new URL(req.url).searchParams.get("status");
    const status = s ? escolha(s, "status", STATUS_ENTREGA) : null;
    return Response.json({ entregas: await listarEntregas(status) });
  });
}
