// GET /api/prospeccao/disparo/diagnostico/:organizationId
// Verifica cada pré-condição do disparo e reporta o que está bloqueando.
// Não dispara nada — apenas diagnóstico (somente leitura).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { getHoraBRT } from "@/lib/prospeccao/disparo";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  const checks: Array<{ item: string; ok: boolean; detalhe: string }> = [];

  const config = await prisma.disparoConfig.findUnique({ where: { organizationId } });

  // 1. Pausa manual
  checks.push({
    item: "pausa_manual",
    ok: !config?.pausadoManualmente,
    detalhe: config?.pausadoManualmente
      ? `PAUSADO: ${config.motivoPausa ?? "sem motivo registrado"} — retome na tela de Disparo`
      : "não pausado",
  });

  // 2. Janela comercial
  const { hora, diaSemana } = getHoraBRT();
  const inicio = config?.janelaInicioHora ?? 9;
  const fim = config?.janelaFimHora ?? 18;
  const dias = config?.diasSemana ?? [1, 2, 3, 4, 5];
  const dentroJanela = dias.includes(diaSemana) && hora >= inicio && hora < fim;
  checks.push({
    item: "janela_comercial",
    ok: dentroJanela,
    detalhe: dentroJanela
      ? `dentro da janela (agora ${hora}h BRT, janela ${inicio}h-${fim}h, dias ${dias.join(",")})`
      : `FORA DA JANELA: agora ${hora}h BRT dia ${diaSemana}, janela ${inicio}h-${fim}h dias ${dias.join(",")} — disparo só roda nesse horário`,
  });

  // 3. Provider + token
  const provider = await prisma.whatsappProviderConfig.findFirst({ where: { organizationId } });
  const token = provider?.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  checks.push({
    item: "provider_whatsapp",
    ok: Boolean(provider),
    detalhe: provider ? `provider ${provider.businessPhoneNumberId} (status ${provider.status})` : "SEM WhatsappProviderConfig para esta org",
  });
  checks.push({
    item: "access_token",
    ok: Boolean(token),
    detalhe: token ? "token disponível" : "SEM access token (provider e env vazios)",
  });

  // 4. Status/qualidade do número (sem efeitos colaterais — leitura direta)
  if (provider) {
    const statusOk = provider.status !== "ERROR" && provider.status !== "BANNED";
    checks.push({
      item: "saude_numero",
      ok: statusOk,
      detalhe: statusOk ? `status ${provider.status}` : `NÚMERO COM PROBLEMA: status ${provider.status}`,
    });
  }

  // 5. Template ativo
  const template = await prisma.templateProspeccao.findFirst({
    where: { organizationId, ativo: true },
  });
  checks.push({
    item: "template_ativo",
    ok: Boolean(template),
    detalhe: template
      ? `template "${template.nomeTemplateMeta}" ativo`
      : "NENHUM template ativo — cadastre/ative um template aprovado pela Meta na tela de Disparo",
  });

  // 6. Leads elegíveis
  const diasEntre = config?.diasEntreTentativas ?? 3;
  const maxTent = config?.maxTentativasContato ?? 3;
  const cutoff = new Date(Date.now() - diasEntre * 24 * 60 * 60 * 1000);
  const [aprovados, retentativas, fixosAprovados, porStatus] = await Promise.all([
    prisma.prospectLead.count({
      where: { organizationId, status: "APROVADO", NOT: { tipoTelefone: "FIXO" } },
    }),
    prisma.prospectLead.count({
      where: {
        organizationId,
        NOT: { tipoTelefone: "FIXO" },
        OR: [
          { status: "ABORDADO", dataAbordagem: { lte: cutoff }, tentativasDisparo: { lt: maxTent } },
          { status: "ERRO_ENVIO", tentativasDisparo: { lt: maxTent } },
        ],
      },
    }),
    prisma.prospectLead.count({
      where: { organizationId, status: "APROVADO", tipoTelefone: "FIXO" },
    }),
    prisma.prospectLead.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),
  ]);

  const elegiveis = aprovados + retentativas;
  checks.push({
    item: "leads_elegiveis",
    ok: elegiveis > 0,
    detalhe: elegiveis > 0
      ? `${aprovados} aprovados + ${retentativas} retentativas (limite diário ${config?.limiteDiarioAtual ?? 15})`
      : `NENHUM lead elegível — aprove leads na fila (status atual: ${porStatus.map((s) => `${s.status}=${s._count}`).join(", ") || "nenhum lead"})${fixosAprovados > 0 ? ` | ATENÇÃO: ${fixosAprovados} aprovados são telefone FIXO e nunca disparam` : ""}`,
  });

  const bloqueios = checks.filter((c) => !c.ok);

  return NextResponse.json({
    prontoParaDisparar: bloqueios.length === 0,
    bloqueios: bloqueios.map((b) => b.detalhe),
    checks,
    config: config ? {
      limiteDiarioAtual: config.limiteDiarioAtual,
      janela: `${config.janelaInicioHora}h-${config.janelaFimHora}h`,
      diasSemana: config.diasSemana,
      pausadoManualmente: config.pausadoManualmente,
    } : "config será criada no primeiro disparo",
  });
}
