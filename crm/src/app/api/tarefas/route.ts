import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { contarVisoes, criarTarefa, listarTarefas, normalizarChecklist, PRIORIDADES, RECORRENCIAS, TIPOS_TAREFA, VISOES, type Visao } from "@/lib/atividades/tarefas";
import { comEntrada, dataOpc, escolha, texto, textoOpc } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  return comEntrada(async () => {
    const u = new URL(req.url).searchParams;
    const visao = escolha<Visao>(u.get("visao") ?? undefined, "visao", VISOES, "abertas");
    const responsavelId = u.get("responsavel") === "todos" ? null : uid;
    const tarefas = await listarTarefas({ visao, responsavelId, oportunidadeId: u.get("oportunidadeId"), contatoId: u.get("contatoId") });
    return Response.json({ tarefas, contadores: await contarVisoes(responsavelId) });
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
    const t = await criarTarefa({
      titulo: texto(c.titulo, "Título", { min: 1, max: 200 }),
      descricao: textoOpc(c.descricao, "Descrição", 5000),
      tipo: escolha(c.tipo, "tipo", TIPOS_TAREFA, "TAREFA"),
      prioridade: escolha(c.prioridade, "prioridade", PRIORIDADES, "NORMAL"),
      prazoEm: dataOpc(c.prazoEm, "Prazo"),
      recorrencia: c.recorrencia ? escolha(c.recorrencia, "recorrência", RECORRENCIAS) : null,
      checklist: normalizarChecklist(c.checklist),
      responsavelId: textoOpc(c.responsavelId, "responsavelId", 60) ?? uid,
      contatoId: textoOpc(c.contatoId, "contatoId", 60),
      oportunidadeId,
      paiId: textoOpc(c.paiId, "paiId", 60),
    });
    return Response.json({ id: t.id }, { status: 201 });
  });
}
