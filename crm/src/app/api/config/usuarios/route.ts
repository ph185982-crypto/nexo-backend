import { exigirAdmin } from "@/lib/auth/admin";
import { criarUsuario, listarUsuarios, PAPEIS } from "@/lib/config/usuarios";
import { comEntrada, escolha, texto } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return Response.json({ usuarios: await listarUsuarios() });
}

export async function POST(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const u = await criarUsuario({ nome: texto(c.nome, "Nome", { min: 1, max: 80 }), email: texto(c.email, "E-mail", { min: 3, max: 200 }), senha: typeof c.senha === "string" ? c.senha : "", papel: escolha(c.papel, "papel", PAPEIS, "VENDEDOR") });
    return Response.json({ id: u.id }, { status: 201 });
  });
}
