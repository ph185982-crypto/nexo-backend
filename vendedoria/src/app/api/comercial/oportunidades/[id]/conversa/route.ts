// Conversa da oportunidade para a linha do tempo da ficha: as mensagens do WhatsApp do Lead (direto do Vendedor IA,
// sem espelho) e as importadas no CRM antigo (ComMensagem), mais o link para abrir a conversa em /crm/conversations.
import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const op = await prisma.comOportunidade.findUnique({
    where: { id },
    select: { leadId: true, contatoId: true, pessoaId: true, pessoa: { select: { leadId: true } }, contato: { select: { leadId: true, pessoas: { select: { id: true } } } } },
  });
  if (!op) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  const contatos = [op.contatoId, op.pessoaId, ...op.contato.pessoas.map((p) => p.id)].filter((x): x is string => Boolean(x));
  const leadId = op.leadId ?? op.pessoa?.leadId ?? op.contato.leadId ?? null;

  if (new URL(req.url).searchParams.get("so") === "link") {
    const c = leadId ? await prisma.whatsappConversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } }, select: { id: true } }) : null;
    return Response.json({ leadId, conversaHref: c ? `/crm/conversations?id=${c.id}` : null });
  }
  const [importadas, conversa] = await Promise.all([
    prisma.comMensagem.findMany({ where: { contatoId: { in: contatos } }, orderBy: { enviadaEm: "desc" }, take: 300, select: { id: true, autor: true, deMim: true, texto: true, enviadaEm: true, origem: true, hash: true } }),
    leadId ? prisma.whatsappConversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } }, select: { id: true, profileName: true } }) : null,
  ]);
  const doWhatsapp = conversa
    ? await prisma.whatsappMessage.findMany({ where: { conversationId: conversa.id }, orderBy: { sentAt: "desc" }, take: 300, select: { id: true, content: true, role: true, sentAt: true, type: true, caption: true } })
    : [];
  // O espelho antigo (origem VENDEDOR_IA) repete o que está no WhatsApp do Lead: com a conversa nativa, só o importado de arquivo.
  const mensagens = [
    ...importadas.filter((m) => !conversa || m.origem !== "VENDEDOR_IA").map((m) => ({ id: m.id, autor: m.autor, deMim: m.deMim, texto: m.texto, enviadaEm: m.enviadaEm, origem: m.origem })),
    ...doWhatsapp.map((m) => ({
      id: m.id, autor: m.role === "USER" ? (conversa?.profileName ?? "Cliente") : "Vendedor IA", deMim: m.role !== "USER",
      texto: m.type === "TEXT" ? m.content : `[${m.type.toLowerCase()}] ${m.caption ?? ""}`.trim(), enviadaEm: m.sentAt, origem: "WHATSAPP",
    })),
  ].sort((a, b) => a.enviadaEm.getTime() - b.enviadaEm.getTime()).slice(-300);
  return Response.json({ mensagens, leadId, conversaHref: conversa ? `/crm/conversations?id=${conversa.id}` : null });
}
