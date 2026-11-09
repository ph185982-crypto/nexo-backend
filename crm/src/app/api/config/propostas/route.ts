// Textos padrão das propostas (introdução e condições). Ler: qualquer usuário; trocar: administrador.
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { exigirAdmin } from "@/lib/auth/admin";
import { comEntrada } from "@/lib/validar";
import { salvarTextosPadrao, textosPadrao } from "@/lib/propostas/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json(await textosPadrao());
}

export async function PUT(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => Response.json(await salvarTextosPadrao(c)));
}
