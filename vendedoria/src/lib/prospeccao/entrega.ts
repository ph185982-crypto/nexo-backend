// Rastreio de entrega dos templates de prospecção: grava o envio (com o wamid
// devolvido pela Meta) e aplica os webhooks de status sobre ele.

import { prisma } from "@/lib/prisma/client";

const ORDEM: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

/** Erros da Meta que mais aparecem em disparo frio, em português. */
export const ERROS_META: Record<number, string> = {
  131049: "A Meta barrou o marketing para este destinatário (limite por usuário / baixo engajamento).",
  131026: "Mensagem não entregável — o número provavelmente não tem WhatsApp.",
  131047: "Fora da janela de 24h — só template aprovado pode ser enviado.",
  131048: "Limite de spam: a qualidade do número está baixa.",
  131056: "Limite de envios para este par de números — tente depois.",
  130472: "Número incluído em experimento da Meta (não entregue).",
  131042: "Problema de pagamento na conta WhatsApp Business.",
  131053: "Falha ao processar a mídia do template.",
  132000: "Quantidade de parâmetros diferente do template aprovado.",
  132001: "Template não existe ou não está aprovado neste idioma.",
  132015: "Template pausado pela Meta por baixa qualidade.",
  132016: "Template desativado pela Meta.",
  133010: "Número do remetente não registrado.",
};

export function explicarErroMeta(codigo: number | null | undefined, mensagem?: string | null): string {
  if (codigo != null && ERROS_META[codigo]) return ERROS_META[codigo];
  return mensagem || (codigo != null ? `Erro ${codigo} da Meta` : "Falha de entrega");
}

export async function registrarEnvio(p: {
  organizationId: string; leadId: string; templateId?: string | null; wamid?: string | null; tentativa: number;
}): Promise<void> {
  try {
    await prisma.disparoEnvio.create({
      data: {
        organizationId: p.organizationId, leadId: p.leadId, templateId: p.templateId ?? null,
        wamid: p.wamid ?? null, tentativa: p.tentativa,
      },
    });
  } catch (e) {
    // Nunca derruba o disparo por causa do rastreio.
    console.error("[Entrega] Falha ao registrar envio:", e);
  }
}

export interface StatusMeta {
  id: string;
  status: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

/** Aplica um webhook de status ao envio de prospecção (se esta mensagem for um). */
export async function aplicarStatusEnvio(s: StatusMeta): Promise<boolean> {
  const envio = await prisma.disparoEnvio.findUnique({ where: { wamid: s.id } });
  if (!envio) return false;

  const quando = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
  const novo = s.status === "failed" ? "FAILED" : s.status.toUpperCase();
  if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(novo)) return true;

  if (novo === "FAILED") {
    const e = s.errors?.[0];
    const mensagem = [e?.title, e?.message, e?.error_data?.details].filter(Boolean).join(" — ").slice(0, 400) || null;
    await prisma.disparoEnvio.update({
      where: { id: envio.id },
      data: { status: "FAILED", falhouEm: quando, erroCodigo: e?.code ?? null, erroMensagem: mensagem },
    });
    // Número sem WhatsApp: não adianta tentar de novo.
    if (e?.code === 131026) {
      await prisma.prospectLead.updateMany({
        where: { id: envio.leadId, status: { in: ["ABORDADO", "ERRO_ENVIO", "APROVADO"] } },
        data: { status: "DESCARTADO", motivoAnaliseIA: "Sem WhatsApp neste número (erro 131026 da Meta)" },
      });
    }
    return true;
  }

  // Só avança (read antes de delivered, ou sent atrasado, não regride o status)
  if ((ORDEM[novo] ?? 0) <= (ORDEM[envio.status] ?? 0)) return true;
  await prisma.disparoEnvio.update({
    where: { id: envio.id },
    data: {
      status: novo,
      ...(novo === "DELIVERED" ? { entregueEm: quando } : {}),
      ...(novo === "READ" ? { lidoEm: quando, entregueEm: envio.entregueEm ?? quando } : {}),
    },
  });
  return true;
}
