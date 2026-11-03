import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const maxDuration = 60;

/** "Executar agora": varre as automações de tempo e processa o que venceu. */
export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const varredura = await varrerTempo();
  return Response.json({ varredura, execucao: await processarVencidas() });
}
