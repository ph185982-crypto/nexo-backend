// Fila de ligações do Pedro: o que precisa de uma pessoa, num lugar só.
// Antes isso virava uma notificação por lead (119 não lidas em 30/10) e
// ninguém olhava. Aqui entram as ligações marcadas pelo SDR e os leads que
// pedem ação humana (escalados, "ligue para o lead", lead frustrado).
import { prisma } from "@/lib/prisma/client";

export interface LigacaoMarcada {
  tipo: "marcada";
  leadId: string;
  conversationId: string | null;
  nome: string;
  empresa: string | null;
  telefone: string;
  quando: string; // ISO
  dor: string | null;
}

export interface LigacaoPendente {
  tipo: "pendente";
  notificacaoId: string;
  leadId: string | null;
  conversationId: string | null;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  titulo: string;
  resumo: string;
  criadoEm: string; // ISO
}

export interface FilaDeLigacoes { marcadas: LigacaoMarcada[]; pendentes: LigacaoPendente[] }

const UM_DIA = 24 * 60 * 60 * 1000;

export async function listarLigacoes(organizationId: string, agora = new Date()): Promise<FilaDeLigacoes> {
  const leadsMarcados = await prisma.lead.findMany({
    where: { organizationId, reuniaoEm: { gte: new Date(agora.getTime() - UM_DIA) } },
    orderBy: { reuniaoEm: "asc" },
    take: 50,
    select: { id: true, profileName: true, phoneNumber: true, empresa: true, reuniaoEm: true, dorPrincipal: true, conversations: { select: { id: true }, take: 1 } },
  });
  const marcadas: LigacaoMarcada[] = leadsMarcados.map((l) => ({
    tipo: "marcada", leadId: l.id, conversationId: l.conversations[0]?.id ?? null,
    nome: l.profileName ?? l.phoneNumber, empresa: l.empresa, telefone: l.phoneNumber,
    quando: l.reuniaoEm!.toISOString(), dor: l.dorPrincipal,
  }));

  const notificacoes = await prisma.ownerNotification.findMany({
    where: { organizationId, read: false, OR: [{ type: "ESCALATION" }, { title: { startsWith: "📞" } }] },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const idsLead = Array.from(new Set(notificacoes.map((n) => n.leadId).filter((x): x is string => Boolean(x))));
  const leads = idsLead.length
    ? await prisma.lead.findMany({ where: { id: { in: idsLead } }, select: { id: true, profileName: true, phoneNumber: true, empresa: true, conversations: { select: { id: true }, take: 1 } } })
    : [];
  const porId = new Map(leads.map((l) => [l.id, l]));
  const pendentes: LigacaoPendente[] = notificacoes.map((n) => {
    const l = n.leadId ? porId.get(n.leadId) : undefined;
    return {
      tipo: "pendente", notificacaoId: n.id, leadId: n.leadId, conversationId: n.conversationId ?? l?.conversations[0]?.id ?? null,
      nome: l?.profileName ?? l?.phoneNumber ?? n.title.replace(/^[^—]*— (ligue para )?/, "").trim() ?? "Lead",
      empresa: l?.empresa ?? null, telefone: l?.phoneNumber ?? null,
      titulo: n.title, resumo: n.body.slice(0, 400), criadoEm: n.createdAt.toISOString(),
    };
  });
  return { marcadas, pendentes };
}
