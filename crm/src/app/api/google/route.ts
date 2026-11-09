// Situação da conexão com o Google do usuário e as reuniões encontradas (DELETE desconecta).
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { credenciaisGoogle, decifrar, enderecoDeRetorno } from "@/lib/google/cliente";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const conta = await prisma.contaGoogle.findUnique({ where: { usuarioId: uid }, select: { id: true, email: true, ativa: true, erro: true, ultimaSincronizacaoEm: true } });
  const reunioes = conta ? await prisma.reuniaoGoogle.findMany({ where: { contaId: conta.id }, orderBy: { inicio: "desc" }, take: 40, select: { id: true, titulo: true, inicio: true, fim: true, emails: true, status: true, oportunidadeId: true, participantes: true } }) : [];
  const precisaVincular = reunioes.some((r) => r.status === "SEM_CLIENTE");
  const oportunidades = precisaVincular
    ? await prisma.oportunidade.findMany({ where: { OR: [{ status: "EM_ANDAMENTO" }, { status: "GANHA", entrega: { status: "EM_ANDAMENTO" } }] }, orderBy: { atualizadoEm: "desc" }, take: 500, select: { id: true, nome: true, contato: { select: { nome: true } } } })
    : [];
  const nomes = new Map((await prisma.oportunidade.findMany({ where: { id: { in: reunioes.map((r) => r.oportunidadeId).filter((x): x is string => Boolean(x)) } }, select: { id: true, nome: true } })).map((o) => [o.id, o.nome]));
  return Response.json({
    configurado: Boolean(credenciaisGoogle()), redirectUri: enderecoDeRetorno(req), conta,
    reunioes: reunioes.map((r) => ({ ...r, oportunidadeNome: r.oportunidadeId ? nomes.get(r.oportunidadeId) ?? null : null })), oportunidades,
  });
}

export async function DELETE(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const conta = await prisma.contaGoogle.findUnique({ where: { usuarioId: uid } });
  if (!conta) return Response.json({ ok: true });
  // Revoga no Google também (melhor esforço: se falhar, o token fica sem uso porque apagamos aqui).
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decifrar(conta.refreshTokenCifrado))}`, { method: "POST", signal: AbortSignal.timeout(8000) }); } catch { /* segue */ }
  await prisma.contaGoogle.delete({ where: { id: conta.id } });
  return Response.json({ ok: true });
}
