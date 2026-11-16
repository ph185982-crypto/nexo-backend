// API de serviço da Central (Avanteza) para o Funil de Entrega — MESMO contrato do CRM antigo
// (crm/docs/integracao-avanteza.md; aqui em docs/integracao-avanteza-entregas.md), lendo as tabelas com_*.
// Chave: AVANTEZA_CRM_KEY (a mesma da Central), comparada em tempo constante. Sem a variável a API fica
// desligada (503), nunca aberta. Nada é registrado em log além de uma frase fixa.
import { createHash, timingSafeEqual } from "node:crypto";
import { ErroEntrada } from "@/lib/comercial/validar";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Devolve a resposta de erro (503/401) ou null quando a chave confere. */
export function autenticarAvanteza(req: Request): Response | null {
  const esperada = process.env.AVANTEZA_CRM_KEY;
  if (!esperada || esperada.length < 16) return Response.json({ erro: "Integração não configurada" }, { status: 503 });
  const m = /^Bearer\s+(\S+)$/.exec((req.headers.get("authorization") ?? "").trim());
  if (!m || !timingSafeEqual(sha(m[1]), sha(esperada))) return Response.json({ erro: "Chave inválida" }, { status: 401 });
  return null;
}

/** Envolve a rota: confere a chave, converte ErroEntrada em 400 e esconde qualquer outro erro (sem dados no log). */
export async function comChaveAvanteza(req: Request, fn: () => Promise<Response>): Promise<Response> {
  const negado = autenticarAvanteza(req);
  if (negado) return negado;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErroEntrada) return Response.json({ erro: e.message }, { status: 400 });
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2003") return Response.json({ erro: "Referência inválida: um dos registros informados não existe" }, { status: 400 });
    console.error("[integracao/avanteza/entregas] falha ao processar a requisição"); // sem dados
    return Response.json({ erro: "Falha ao processar a requisição" }, { status: 500 });
  }
}

export async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  const c = (await req.json().catch(() => null)) as unknown;
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new ErroEntrada("Corpo inválido");
  return c as Record<string, unknown>;
}
