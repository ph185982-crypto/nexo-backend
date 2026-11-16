// Resposta padrão das rotas de contratos: ErroContrato vira o status dele; o resto, 500 sem detalhe interno.
import { ErroContrato } from "./servico";

export async function responder(f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof ErroContrato) return Response.json({ erro: e.message }, { status: e.status });
    console.error("[contratos]", e);
    return Response.json({ erro: "Erro interno" }, { status: 500 });
  }
}
