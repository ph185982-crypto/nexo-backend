import { prisma } from "@/lib/prisma/client";
import { criarOportunidade } from "@/lib/comercial/funil/mover";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { normalizarTelefone } from "@/lib/comercial/integracao/vendedor-ia";

export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as {
    nome?: string; contatoNome?: string; telefone?: string; funilId?: string; valorUnico?: number; valorMensal?: number;
  } | null;
  const nome = c?.nome?.trim();
  const contatoNome = c?.contatoNome?.trim();
  if (!nome || !contatoNome) return Response.json({ erro: "Informe o nome da oportunidade e do contato" }, { status: 400 });
  const valor = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12 ? v : 0);

  const telefone = normalizarTelefone(c?.telefone);
  let contato = telefone ? await prisma.comContato.findFirst({ where: { telefone } }) : null;
  contato ??= await prisma.comContato.create({ data: { tipo: "EMPRESA", nome: contatoNome, telefone, responsavelId: uid, origem: "Manual" } });

  try {
    const op = await criarOportunidade({
      nome, contatoId: contato.id, funilId: c?.funilId || null, responsavelId: uid,
      valorUnico: valor(c?.valorUnico), valorMensal: valor(c?.valorMensal), origem: "Manual", ator: uid,
    });
    return Response.json({ id: op.id }, { status: 201 });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : "Erro ao criar" }, { status: 400 });
  }
}
