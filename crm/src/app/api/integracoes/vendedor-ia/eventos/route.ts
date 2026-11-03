// Recebe eventos do Vendedor IA. Autenticação: Authorization: Bearer avz_live_… (chave de serviço).
import { validarChave } from "@/lib/integracao/chave";
import { processarEventoVendedorIa, validarEvento } from "@/lib/integracao/vendedor-ia";

export async function POST(req: Request) {
  if (!(await validarChave(req))) return Response.json({ erro: "Chave inválida" }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  const v = validarEvento(corpo);
  if (!v.ok) return Response.json({ erro: v.erro }, { status: 400 });
  try {
    const r = await processarEventoVendedorIa(v.evento);
    // DUPLICADO responde 200: reenviar o mesmo evento é seguro e não é erro.
    return Response.json(r, { status: 200 });
  } catch (e) {
    console.error("[integracao/vendedor-ia]", e);
    return Response.json({ erro: "Falha ao processar o evento" }, { status: 500 });
  }
}
