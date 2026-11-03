import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { criarCompromisso, listarCompromissos, TIPOS_COMPROMISSO } from "@/lib/atividades/compromissos";
import { comEntrada, dataObrig, escolha, texto, textoOpc } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  return comEntrada(async () => {
    const u = new URL(req.url).searchParams;
    const de = dataObrig(u.get("de"), "de");
    const ate = dataObrig(u.get("ate"), "ate");
    if (ate.getTime() - de.getTime() > 62 * 86_400_000) return Response.json({ erro: "Intervalo máximo de 62 dias" }, { status: 400 });
    return Response.json({ compromissos: await listarCompromissos(de, ate, u.get("responsavel") === "todos" ? null : uid) });
  });
}

export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const oportunidadeId = textoOpc(c.oportunidadeId, "oportunidadeId", 60);
    if (oportunidadeId && !(await prisma.oportunidade.findUnique({ where: { id: oportunidadeId }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    const participantes = Array.isArray(c.participantes) ? c.participantes.map((p) => texto(p, "participante", { max: 200 })).filter((p) => /^\S+@\S+\.\S+$/.test(p)).slice(0, 20) : [];
    try {
      const r = await criarCompromisso({
        assunto: texto(c.assunto, "Assunto", { min: 1, max: 200 }), tipo: escolha(c.tipo, "tipo", TIPOS_COMPROMISSO, "REUNIAO"),
        inicio: dataObrig(c.inicio, "Início"), fim: dataObrig(c.fim, "Fim"), local: textoOpc(c.local, "Local", 200), descricao: textoOpc(c.descricao, "Descrição", 5000),
        participantes, responsavelId: uid, contatoId: textoOpc(c.contatoId, "contatoId", 60), oportunidadeId,
      });
      return Response.json({ id: r.id }, { status: 201 });
    } catch (e) {
      return Response.json({ erro: e instanceof Error ? e.message : "Erro ao criar" }, { status: 400 });
    }
  });
}
