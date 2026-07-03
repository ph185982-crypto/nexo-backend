import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppTemplate, normalizeBrazilianNumber } from "@/lib/whatsapp/send";
import { verificarSaudeNumero } from "./saude-numero";
import { garantirLeadDoProspect, moverLeadPorTipo, colunaPorTentativa } from "@/lib/crm/pipeline-mover";

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

function dentroJanela(config: {
  janelaInicioHora: number;
  janelaFimHora: number;
  diasSemana: number[];
}): boolean {
  const agora = new Date();
  const hora = agora.getHours();
  const diaSemana = agora.getDay(); // 0=dom, 1=seg, ..., 6=sab
  return (
    config.diasSemana.includes(diaSemana) &&
    hora >= config.janelaInicioHora &&
    hora < config.janelaFimHora
  );
}

function montarComponentesTemplate(
  variaveis: string[],
  lead: {
    nome?: string | null;
    sinalOportunidade?: string | null;
    telefone?: string | null;
    website?: string | null;
    tipoNegocio?: string | null;
  },
): unknown[] {
  if (variaveis.length === 0) return [];

  const valoresMap: Record<string, string> = {
    nomeNegocio: lead.nome ?? "seu negócio",
    sinalOportunidade: lead.sinalOportunidade ?? "oportunidade identificada",
    telefone: lead.telefone ?? "",
    website: lead.website ?? "",
    tipoNegocio: lead.tipoNegocio ?? "",
  };

  const parameters = variaveis.map((v) => ({
    type: "text",
    text: valoresMap[v] ?? v,
  }));

  return [{ type: "body", parameters }];
}

/**
 * Executa uma rodada de disparos diários para a organização.
 * Respeita limite, janela de horário, pausa manual e saúde do número.
 */
export async function executarDisparoDiario(organizationId: string): Promise<{
  disparados: number;
  ignorados: number;
  erros: number;
  motivo?: string;
}> {
  const resultado = { disparados: 0, ignorados: 0, erros: 0 };

  // 1. Buscar ou criar config de disparo
  let config = await prisma.disparoConfig.findUnique({ where: { organizationId } });
  if (!config) {
    config = await prisma.disparoConfig.create({ data: { organizationId } });
  }

  // 2. Checar pausa manual
  if (config.pausadoManualmente) {
    console.log(`[Disparo] Pausado manualmente para org ${organizationId}: ${config.motivoPausa ?? ""}`);
    return { ...resultado, motivo: config.motivoPausa ?? "pausado manualmente" };
  }

  // 3. Verificar saúde do número (inclui checa status ERROR/BANNED)
  const saudavel = await verificarSaudeNumero(organizationId);
  if (!saudavel) {
    // verificarSaudeNumero já pausou e notificou
    return { ...resultado, motivo: "número com problema de qualidade ou status — disparo pausado" };
  }

  // 4. Verificar janela de horário
  if (!dentroJanela(config)) {
    return { ...resultado, motivo: "fora da janela comercial configurada" };
  }

  // 5. Buscar provider da org
  const providerConfig = await prisma.whatsappProviderConfig.findFirst({
    where: { organizationId },
  });
  if (!providerConfig) {
    return { ...resultado, motivo: "sem WhatsappProviderConfig" };
  }

  const token = providerConfig.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return { ...resultado, motivo: "sem access token" };
  }

  // 6. Buscar template ativo
  const template = await prisma.templateProspeccao.findFirst({
    where: { organizationId, ativo: true },
  });
  if (!template) {
    console.warn(`[Disparo] Nenhum TemplateProspeccao ativo para org ${organizationId} — disparo abortado`);
    return { ...resultado, motivo: "nenhum template ativo cadastrado" };
  }

  // 7. Buscar leads: APROVADOS (1ª tentativa) + ABORDADOS sem resposta que
  //    já passaram do intervalo entre tentativas (2ª/3ª tentativa).
  //    Nunca dispara para telefone FIXO (template WhatsApp só chega em celular).
  const cutoffRetentativa = new Date(Date.now() - config.diasEntreTentativas * 24 * 60 * 60 * 1000);
  const leads = await prisma.prospectLead.findMany({
    where: {
      organizationId,
      NOT: { tipoTelefone: "FIXO" },
      OR: [
        { status: "APROVADO" },
        {
          status: "ABORDADO",
          dataAbordagem: { lte: cutoffRetentativa },
          tentativasDisparo: { lt: config.maxTentativasContato },
        },
      ],
    },
    orderBy: [{ tentativasDisparo: "asc" }, { score: "desc" }],
    take: config.limiteDiarioAtual,
  });

  if (leads.length === 0) {
    return { ...resultado, motivo: "nenhum lead APROVADO ou retentativa disponível" };
  }

  console.log(`[Disparo] ${leads.length} leads para disparar | template=${template.nomeTemplateMeta} | limite=${config.limiteDiarioAtual}`);

  // 8. Disparar
  for (const lead of leads) {
    if (!lead.telefone) {
      resultado.ignorados++;
      continue;
    }

    try {
      const telefoneNormalizado = normalizeBrazilianNumber(
        lead.telefone.replace(/\D/g, ""),
      );

      const components = montarComponentesTemplate(template.variaveis, lead);

      await sendWhatsAppTemplate(
        providerConfig.businessPhoneNumberId,
        telefoneNormalizado,
        template.nomeTemplateMeta,
        template.idioma,
        components,
        token,
      );

      const atualizado = await prisma.prospectLead.update({
        where: { id: lead.id },
        data: {
          status: "ABORDADO",
          dataAbordagem: new Date(),
          tentativasDisparo: { increment: 1 },
          templateUsadoId: template.id,
        },
      });

      // CRM: garante Lead no funil e move para a coluna da tentativa (1º/2º/3º Contato)
      const crmLeadId = await garantirLeadDoProspect(atualizado);
      if (crmLeadId) {
        await moverLeadPorTipo(
          crmLeadId,
          organizationId,
          colunaPorTentativa(atualizado.tentativasDisparo),
          `Disparo de prospecção — tentativa ${atualizado.tentativasDisparo}`,
        );
      }

      resultado.disparados++;
      console.log(`[Disparo] OK | lead=${lead.id} | tel=${telefoneNormalizado} | tentativa=${atualizado.tentativasDisparo}`);

      // Delay aleatório entre disparos: 30–90 segundos
      if (lead !== leads[leads.length - 1]) {
        await randomDelay(30_000, 90_000);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Disparo] Falha | lead=${lead.id} |`, errMsg);

      await prisma.prospectLead.update({
        where: { id: lead.id },
        data: {
          status: "DESCARTADO",
          motivoAnaliseIA: `Falha no envio: ${errMsg.slice(0, 200)}`,
          tentativasDisparo: { increment: 1 },
        },
      });

      resultado.erros++;
    }
  }

  return resultado;
}

/**
 * Incrementa o limite diário de warm-up semanalmente.
 * Roda via cron semanal.
 */
export async function incrementarWarmupSemanal(organizationId: string): Promise<void> {
  const config = await prisma.disparoConfig.findUnique({ where: { organizationId } });
  if (!config) return;

  const novoLimite = Math.min(
    config.limiteDiarioAtual + config.incrementoSemanal,
    config.limiteMaximoDiario,
  );

  await prisma.disparoConfig.update({
    where: { organizationId },
    data: {
      limiteDiarioAtual: novoLimite,
      ultimaAtualizacaoLimite: new Date(),
    },
  });

  console.log(`[Warmup] Org ${organizationId}: limite ${config.limiteDiarioAtual} → ${novoLimite}`);
}
