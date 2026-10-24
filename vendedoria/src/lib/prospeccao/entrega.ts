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
  131042: "Conta do WhatsApp Business com pagamento pendente — nenhum template sai até regularizar no Billing Hub da Meta (business.facebook.com/billing_hub).",
  131053: "Falha ao processar a mídia do template.",
  132000: "Quantidade de parâmetros diferente do template aprovado.",
  132001: "Template não existe ou não está aprovado neste idioma.",
  132015: "Template pausado pela Meta por baixa qualidade.",
  132016: "Template desativado pela Meta.",
  133010: "Número do remetente não registrado.",
};

/**
 * Falhas da CONTA (não do destinatário): enquanto durarem, nenhum envio chega.
 * O disparo pausa sozinho e o lead volta para a fila sem gastar tentativa.
 */
export const ERROS_DE_CONTA = new Set([131042, 131031, 131048, 368]);

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
    // Falha da conta: pausa o disparo e devolve o lead para a fila (não foi culpa dele).
    if (e?.code != null && ERROS_DE_CONTA.has(e.code)) {
      await tratarFalhaDeConta(envio.organizationId, envio.leadId, e.code, mensagem);
      return true;
    }
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

/** Pausa o disparo (uma vez, com aviso ao dono) e devolve o lead para APROVADO. */
async function tratarFalhaDeConta(organizationId: string, leadId: string, codigo: number, mensagem: string | null): Promise<void> {
  const motivo = `Pausado automaticamente: ${explicarErroMeta(codigo)} [erro ${codigo}]`;
  const pausou = await prisma.disparoConfig.updateMany({
    where: { organizationId, pausadoManualmente: false },
    data: { pausadoManualmente: true, motivoPausa: motivo.slice(0, 300) },
  }).catch(() => ({ count: 0 }));
  if (pausou.count > 0) {
    console.error(`[Entrega] ⛔ Disparo pausado na org ${organizationId}: erro de conta ${codigo}`);
    await prisma.ownerNotification.create({
      data: {
        type: "INFO",
        title: "⛔ Disparos pausados: a Meta está recusando por problema na conta",
        body: `${explicarErroMeta(codigo)}\n\n${mensagem ?? ""}\n\nDepois de resolver, retome em Prospecção → Disparo. Os leads afetados voltaram para a fila.`.slice(0, 2000),
        organizationId,
      },
    }).catch(() => {});
  }
  const lead = await prisma.prospectLead.findUnique({ where: { id: leadId }, select: { status: true, tentativasDisparo: true } });
  if (lead && ["ABORDADO", "ERRO_ENVIO"].includes(lead.status)) {
    await prisma.prospectLead.update({
      where: { id: leadId },
      data: {
        status: "APROVADO",
        dataAbordagem: null,
        tentativasDisparo: Math.max((lead.tentativasDisparo ?? 1) - 1, 0),
        motivoAnaliseIA: `Não entregue (erro ${codigo} da conta) — voltou para a fila`,
      },
    }).catch(() => {});
  }
}

/**
 * Leads marcados como abordados que NUNCA receberam nada: todos os envios
 * rastreados falharam por erro de conta. `aplicar=false` só conta.
 */
export async function recuperarLeadsNaoEntregues(organizationId: string, aplicar: boolean): Promise<{ encontrados: number; recuperados: number }> {
  const codigos = Array.from(ERROS_DE_CONTA);
  const falhas = await prisma.disparoEnvio.findMany({
    where: { organizationId, status: "FAILED", erroCodigo: { in: codigos } },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  const candidatos = falhas.map((f) => f.leadId);
  if (candidatos.length === 0) return { encontrados: 0, recuperados: 0 };

  // Exclui quem tem QUALQUER envio que não seja falha de conta (chegou, ou falhou por outro motivo)
  const outros = await prisma.disparoEnvio.findMany({
    where: {
      leadId: { in: candidatos },
      NOT: { status: "FAILED", erroCodigo: { in: codigos } },
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  const excluir = new Set(outros.map((o) => o.leadId));
  const ids = candidatos.filter((id) => !excluir.has(id));
  const elegiveis = await prisma.prospectLead.count({
    where: { id: { in: ids }, status: { in: ["ABORDADO", "ERRO_ENVIO"] } },
  });
  if (!aplicar) return { encontrados: elegiveis, recuperados: 0 };

  let recuperados = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const r = await prisma.prospectLead.updateMany({
      where: { id: { in: ids.slice(i, i + 500) }, status: { in: ["ABORDADO", "ERRO_ENVIO"] } },
      data: { status: "APROVADO", dataAbordagem: null, tentativasDisparo: 0, motivoAnaliseIA: "Recuperado: nunca recebeu a mensagem (falha da conta na Meta)" },
    });
    recuperados += r.count;
  }
  return { encontrados: elegiveis, recuperados };
}
