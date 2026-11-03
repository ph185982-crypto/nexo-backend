import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { importarCsv, LIMITE_BYTES_IMPORTACAO } from "@/lib/contatos/servico";
import { comEntrada, ErroEntrada } from "@/lib/validar";

export const maxDuration = 60;

/** { csv: "…", simular: true|false }. Simular conta e aponta problemas sem gravar nada. */
export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE_BYTES_IMPORTACAO * 2) return Response.json({ erro: "Arquivo grande demais (máximo de 2 MB)" }, { status: 413 });
  const c = (await req.json().catch(() => null)) as { csv?: unknown; simular?: unknown } | null;
  return comEntrada(async () => {
    if (typeof c?.csv !== "string" || !c.csv.trim()) throw new ErroEntrada("Envie o conteúdo do CSV");
    return Response.json(await importarCsv(c.csv, { simular: c.simular !== false, responsavelId: uid }));
  });
}
