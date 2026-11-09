import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { rodarRotinaDeEntregas } from "@/lib/entrega/rotina";
import { processarPendentes } from "@/lib/combinados/fontes";
import { sincronizarTodas } from "@/lib/google/reunioes";
import { analisarConversasOciosas } from "@/lib/conversas/importar";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const maxDuration = 300;

/** "Executar agora": varre as automações de tempo e processa o que venceu. */
export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const entregas = await rodarRotinaDeEntregas();
  const varredura = await varrerTempo();
  const execucao = await processarVencidas();
  // Agente de combinados: o que ficou na fila (análise que não rodou depois da resposta).
  // Reuniões do Meet primeiro: as transcrições novas entram na fila do agente desta mesma rodada.
  const google = await sincronizarTodas().catch(() => ({ contas: 0, vinculadas: 0, erros: 1 }));
  const conversas = await analisarConversasOciosas({ agendarAgente: false }).catch(() => ({ analises: 0 }));
  const agente = await processarPendentes(5);
  return Response.json({ entregas, varredura, execucao, google, conversas, agente });
}
