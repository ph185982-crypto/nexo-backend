// Contexto de "chamada de serviço" da Central Avanteza.
//
// As rotas /api/financeiro/* exigem um ADMIN logado (auth()). A API de serviço da Central
// (/api/integracoes/avanteza/financeiro/*) reaproveita essas MESMAS rotas — assim o Max, a tela do Vendedor IA e a
// Central usam exatamente a mesma regra de negócio — mas quem chama é um servidor, sem sessão. Depois de conferir a
// chave AVANTEZA_FINANCE_KEY (em tempo constante), a rota de serviço executa o handler dentro de `emServico`, e
// só aí `auth()` devolve a sessão de serviço. O AsyncLocalStorage é local ao processo e à chamada: nenhuma
// requisição externa consegue ligá-lo (não vem de header nem de cookie).
import { AsyncLocalStorage } from "node:async_hooks";

const contexto = new AsyncLocalStorage<{ servico: true }>();

export function emServico<T>(fn: () => Promise<T>): Promise<T> {
  return contexto.run({ servico: true }, fn);
}

export function servicoAtivo(): boolean {
  return contexto.getStore()?.servico === true;
}

/** Sessão fictícia que as rotas financeiras aceitam como ADMIN (sem e-mail real, sem dado pessoal). */
export const SESSAO_SERVICO = {
  user: { id: "servico-avanteza-financeiro", name: "Central Avanteza (serviço)", email: "servico@avanteza.invalid", role: "ADMIN" },
  expires: "2999-12-31T00:00:00.000Z",
} as const;
