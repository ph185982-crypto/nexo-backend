import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { mesclarContatos } from "@/lib/contatos/servico";
import { comEntrada, texto } from "@/lib/validar";

/** { origemId, destinoId }: a origem deixa de existir; o destino fica com tudo. Irreversível. */
export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => Response.json({ movidos: await mesclarContatos(texto(c.origemId, "origemId", { min: 1, max: 60 }), texto(c.destinoId, "destinoId", { min: 1, max: 60 })) }));
}
