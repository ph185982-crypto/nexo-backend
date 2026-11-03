import { criarAutomacao, listarAutomacoes } from "@/lib/automacao/servico";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json({ automacoes: await listarAutomacoes() });
}

export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const corpo = await req.json().catch(() => null);
  if (!corpo) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => Response.json({ id: (await criarAutomacao(corpo, uid)).id }, { status: 201 }));
}
