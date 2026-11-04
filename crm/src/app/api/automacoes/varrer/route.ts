import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { rodarRotinaDeEntregas } from "@/lib/entrega/rotina";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const maxDuration = 60;

/** "Executar agora": varre as automações de tempo e processa o que venceu. */
export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const entregas = await rodarRotinaDeEntregas();
  const varredura = await varrerTempo();
  return Response.json({ entregas, varredura, execucao: await processarVencidas() });
}
