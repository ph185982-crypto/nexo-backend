import { after } from "next/server";

/**
 * Roda `tarefa` depois de a resposta sair (Next `after`): o usuário não espera por trabalho lento.
 * Fora de uma requisição (teste, script) `after` lança: devolve false e quem chamou decide o que fazer.
 */
export function depoisDaResposta(tarefa: () => Promise<unknown>): boolean {
  try {
    after(async () => {
      try { await tarefa(); } catch (e) { console.error("[segundo-plano]", e); }
    });
    return true;
  } catch {
    return false;
  }
}
