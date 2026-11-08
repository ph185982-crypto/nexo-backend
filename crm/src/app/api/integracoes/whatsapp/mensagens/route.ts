// Recebe a conversa aberta no WhatsApp Web, enviada pela extensão do Chrome (crm/extensao).
// Autenticação: Authorization: Bearer avz_live_… (chave de serviço criada em Configuração → Chaves).
import { validarChave } from "@/lib/integracao/chave";
import { comEntrada, textoOpc } from "@/lib/validar";
import { importarConversa, validarMensagens } from "@/lib/conversas/importar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await validarChave(req))) return Response.json({ erro: "Chave inválida" }, { status: 401 });
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await importarConversa({ telefone: textoOpc(c.telefone, "Telefone", 40), nome: textoOpc(c.nome, "Nome", 120), mensagens: validarMensagens(c.mensagens), origem: "EXTENSAO" });
    return Response.json(r, { status: 201 });
  });
}
