// Credenciais do OAuth do Google guardadas no CRM (só administrador). Variáveis de ambiente, se existirem, valem mais.
import { exigirAdmin } from "@/lib/auth/admin";
import { comEntrada } from "@/lib/validar";
import { apagarCredenciais, salvarCredenciais, validarCredenciais } from "@/lib/google/cliente";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    await salvarCredenciais(validarCredenciais(c.clientId, c.clientSecret));
    return Response.json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  await apagarCredenciais();
  return Response.json({ ok: true });
}
