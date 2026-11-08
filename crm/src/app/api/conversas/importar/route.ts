// Importação pela tela (arquivo "Exportar conversa"): a pessoa escolhe o contato e quem é ela no arquivo.
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, texto } from "@/lib/validar";
import { importarConversa, validarMensagens } from "@/lib/conversas/importar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await importarConversa({ contatoId: texto(c.contatoId, "Contato", { min: 1, max: 60 }), mensagens: validarMensagens(c.mensagens), origem: "ARQUIVO" });
    return Response.json(r, { status: 201 });
  });
}
