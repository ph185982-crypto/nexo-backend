import { listarEntregas } from "@/lib/entrega/servico";
import { STATUS_ENTREGA } from "@/lib/entrega/constantes";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return comEntrada(async () => {
    const s = new URL(req.url).searchParams.get("status");
    const status = s ? escolha(s, "status", STATUS_ENTREGA) : null;
    return Response.json({ entregas: await listarEntregas(status) });
  });
}
