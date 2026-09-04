// Encadeamento de jobs longos em ambiente serverless.
//
// Uma função na Vercel morre quando devolve a resposta, então trabalho que passa
// do orçamento de tempo precisa continuar numa invocação nova. Este módulo é o
// único ponto que sabe como agendar essa continuação:
//
//   • Com QSTASH_TOKEN → publica no QStash, que entrega o callback com atraso
//     real, retry e backoff. É o modo recomendado em produção, e o único que
//     honra atrasos longos (os 30–90s entre disparos, por exemplo).
//   • Sem QSTASH_TOKEN → dispara um fetch para a própria aplicação e não espera
//     a resposta. Serve para encadear lotes que não precisam de atraso; atrasos
//     longos viram responsabilidade de quem chamou.

const QSTASH_API = "https://qstash.upstash.io/v2/publish";

export interface ResultadoEnfileiramento {
  ok: boolean;
  via: "qstash" | "self-fetch" | "nenhum";
  /** true quando o atraso pedido foi realmente respeitado pelo agendador. */
  atrasoHonrado: boolean;
  erro?: string;
}

/** URL pública da aplicação, usada como destino do callback. */
export function urlBase(): string {
  const explicita = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (explicita) return explicita.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Agenda a continuação de um job.
 *
 * @param caminho  rota interna que continua o trabalho, ex: "/api/cron/disparo-diario"
 * @param opts.delaySegundos  atraso desejado; só é garantido via QStash
 * @param opts.corpo          payload JSON entregue no POST
 */
export async function enfileirar(
  caminho: string,
  opts: { delaySegundos?: number; corpo?: unknown } = {},
): Promise<ResultadoEnfileiramento> {
  const { delaySegundos = 0, corpo } = opts;
  const destino = `${urlBase()}${caminho}`;
  const segredo = process.env.CRON_SECRET;
  const token = process.env.QSTASH_TOKEN;

  if (token) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (delaySegundos > 0) {
        headers["Upstash-Delay"] = `${Math.ceil(delaySegundos)}s`;
      }
      // QStash repassa headers prefixados com Upstash-Forward- para o destino.
      if (segredo) headers["Upstash-Forward-x-cron-secret"] = segredo;

      const res = await fetch(`${QSTASH_API}/${destino}`, {
        method: "POST",
        headers,
        body: JSON.stringify(corpo ?? {}),
      });

      if (res.ok) return { ok: true, via: "qstash", atrasoHonrado: true };

      const detalhe = (await res.text()).slice(0, 200);
      console.error(`[Fila] QStash recusou (${res.status}): ${detalhe}`);
    } catch (e) {
      console.error("[Fila] QStash indisponível:", e);
    }
  }

  // Sem QStash: chama a própria aplicação e segue em frente. A invocação já
  // começou do lado do servidor, então abandonar a resposta não a cancela.
  try {
    const controller = new AbortController();
    const solta = setTimeout(() => controller.abort(), 1_500);

    await fetch(destino, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(segredo ? { "x-cron-secret": segredo } : {}),
      },
      body: JSON.stringify(corpo ?? {}),
      signal: controller.signal,
    }).catch((e) => {
      // AbortError é o caminho normal: a requisição foi entregue e largamos.
      if ((e as Error).name !== "AbortError") throw e;
    });

    clearTimeout(solta);
    return { ok: true, via: "self-fetch", atrasoHonrado: delaySegundos === 0 };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[Fila] Falha ao encadear ${caminho}:`, erro);
    return { ok: false, via: "nenhum", atrasoHonrado: false, erro };
  }
}

/**
 * Orçamento de tempo de uma invocação. Cada lote para bem antes do limite da
 * função para sobrar folga para gravar progresso e agendar a continuação.
 */
export function criarOrcamento(limiteSegundos: number, folgaSegundos = 10) {
  const inicio = Date.now();
  const tetoMs = Math.max(limiteSegundos - folgaSegundos, 5) * 1_000;
  return {
    estourou: () => Date.now() - inicio >= tetoMs,
    restanteMs: () => Math.max(tetoMs - (Date.now() - inicio), 0),
    decorridoMs: () => Date.now() - inicio,
  };
}
