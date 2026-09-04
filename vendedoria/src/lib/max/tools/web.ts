import { webSearch } from "../openai";

export async function buscarNaWeb(args: Record<string, unknown>): Promise<string> {
  const consulta = args.consulta as string;
  const resultado = await webSearch(consulta);
  return resultado;
}
