import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { rodarRotinaDeEntregas } from "@/lib/entrega/rotina";
import { processarPendentes } from "@/lib/combinados/fontes";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const maxDuration = 300;

/** "Executar agora": varre as automações de tempo e processa o que venceu. */
export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const entregas = await rodarRotinaDeEntregas();
  const varredura = await varrerTempo();
  const execucao = await processarVencidas();
  // Agente de combinados: o que ficou na fila (análise que não rodou depois da resposta).
  const agente = await processarPendentes(5);
  return Response.json({ entregas, varredura, execucao, agente });
}
