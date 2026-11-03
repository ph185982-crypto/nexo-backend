import { exigirAdmin } from "@/lib/auth/admin";
import { criarFunil, listarFunisConfig } from "@/lib/config/funis";
import { comEntrada, texto } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return Response.json({ funis: await listarFunisConfig() });
}

export async function POST(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => Response.json({ id: (await criarFunil(texto(c.nome, "Nome", { min: 1, max: 80 }), c.padrao === true)).id }, { status: 201 }));
}
