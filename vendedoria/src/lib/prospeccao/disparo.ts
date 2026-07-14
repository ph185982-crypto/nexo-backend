import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppTemplate, normalizeBrazilianNumber } from "@/lib/whatsapp/send";
import { verificarSaudeNumero } from "./saude-numero";
import { garantirLeadDoProspect, moverLeadPorTipo, colunaPorTentativa } from "@/lib/crm/pipeline-mover";

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

export function getHoraBRT(): { hora: number; diaSemana: number } {
  const agora = new Date();
  const brt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(agora);
  const hora = Number(brt.find((p) => p.type === "hour")?.value ?? agora.getHours());
  const dayMap: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sáb: 6 };
  const dayStr = (brt.find((p) => p.type === "weekday")?.value ?? "").toLowerCase().replace(".", "");
  const diaSemana = dayMap[dayStr] ?? agora.getDay();
  return { hora, diaSemana };
}

function dentroJanela(config: {
  janelaInicioHora: number;
  janelaFimHora: number;
  diasSemana: number[];
}): boolean {
  const { hora, diaSemana } = getHoraBRT();
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
  extra: { nomeResponsavel?: string } = {},
): unknown[] {
  if (variaveis.length === 0) return [];

  const valoresMap: Record<string, string> = {
    nomeResponsavel: extra.nomeResponsavel ?? "",
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
        {
          status: "ERRO_ENVIO",
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

  // 8. Enfileirar na fila persistente (sobrevive a restart do PM2) — pula leads já na fila
  const jaNaFila = await prisma.disparoJob.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, status: { in: ["QUEUED", "RUNNING"] } },
    select: { leadId: true },
  });
  const jaNaFilaSet = new Set(jaNaFila.map((j) => j.leadId));
  const novos = leads.filter((l) => !jaNaFilaSet.has(l.id));

  if (novos.length > 0) {
    await prisma.disparoJob.createMany({
      data: novos.map((l) => ({ organizationId, leadId: l.id })),
    });
  }

  // 9. Processar a fila (novos + qualquer QUEUED pendente de rodadas anteriores)
  return processarFilaDisparo(organizationId, { config, providerConfig, token, template });
}

// ── Processador da fila persistente ────────────────────────────────────────────

type ContextoDisparo = {
  config: NonNullable<Awaited<ReturnType<typeof prisma.disparoConfig.findUnique>>>;
  providerConfig: NonNullable<Awaited<ReturnType<typeof prisma.whatsappProviderConfig.findFirst>>>;
  token: string;
  template: NonNullable<Awaited<ReturnType<typeof prisma.templateProspeccao.findFirst>>>;
};

async function processarFilaDisparo(
  organizationId: string,
  ctx: ContextoDisparo,
): Promise<{ disparados: number; ignorados: number; erros: number; motivo?: string }> {
  const { config, providerConfig, token, template } = ctx;
  const resultado = { disparados: 0, ignorados: 0, erros: 0 };

  for (;;) {
    // Sai da janela comercial no meio do lote → deixa o resto QUEUED (retomado depois)
    if (!dentroJanela(config)) {
      const restantes = await prisma.disparoJob.count({ where: { organizationId, status: "QUEUED" } });
      if (restantes > 0) console.log(`[Disparo] Janela fechou — ${restantes} jobs ficam na fila`);
      break;
    }

    // Claim atômico do próximo job QUEUED
    const proximo = await prisma.disparoJob.findFirst({
      where: { organizationId, status: "QUEUED" },
      orderBy: { criadoEm: "asc" },
    });
    if (!proximo) break;

    const claimed = await prisma.disparoJob.updateMany({
      where: { id: proximo.id, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
    if (claimed.count === 0) continue; // outro processador pegou

    const lead = await prisma.prospectLead.findUnique({ where: { id: proximo.leadId } });

    // Lead sumiu, mudou de status (ex: respondeu nesse meio-tempo) ou sem telefone → ignora
    if (!lead || !lead.telefone || !["APROVADO", "ABORDADO", "ERRO_ENVIO"].includes(lead.status)) {
      await prisma.disparoJob.update({
        where: { id: proximo.id },
        data: { status: "DONE", erro: lead ? `pulado (status ${lead.status})` : "lead removido" },
      });
      resultado.ignorados++;
      continue;
    }

    try {
      const telefoneNormalizado = normalizeBrazilianNumber(lead.telefone.replace(/\D/g, ""));
      const components = montarComponentesTemplate(template.variaveis, lead, { nomeResponsavel: providerConfig.accountName });

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

      await prisma.disparoJob.update({ where: { id: proximo.id }, data: { status: "DONE" } });
      resultado.disparados++;
      console.log(`[Disparo] OK | lead=${lead.id} | tel=${telefoneNormalizado} | tentativa=${atualizado.tentativasDisparo}`);

      // Delay aleatório entre disparos: 30–90 segundos (anti-bloqueio Meta)
      const haMais = await prisma.disparoJob.count({ where: { organizationId, status: "QUEUED" } });
      if (haMais > 0) await randomDelay(30_000, 90_000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Disparo] Falha | lead=${lead.id} |`, errMsg);

      const tentativas = (lead.tentativasDisparo ?? 0) + 1;
      const esgotouTentativas = tentativas >= (config.maxTentativasContato ?? 3);

      await prisma.prospectLead.update({
        where: { id: lead.id },
        data: {
          status: esgotouTentativas ? "DESCARTADO" : "ERRO_ENVIO",
          motivoAnaliseIA: `Falha no envio (tentativa ${tentativas}): ${errMsg.slice(0, 200)}`,
          tentativasDisparo: { increment: 1 },
        },
      });
      await prisma.disparoJob.update({
        where: { id: proximo.id },
        data: { status: "FAILED", erro: errMsg.slice(0, 300) },
      });

      resultado.erros++;
    }
  }

  return resultado;
}

// ── Retomada pós-restart — chamada pelo healthcheck a cada 5min ────────────────

let retomadaAtiva = false;

/**
 * Retoma jobs QUEUED deixados para trás (restart do PM2 no meio do lote ou
 * janela comercial que fechou). RUNNING órfãos (>15min sem update) voltam a QUEUED.
 */
export async function retomarDisparosPendentes(): Promise<void> {
  if (retomadaAtiva) return;
  retomadaAtiva = true;
  try {
    // Requeue de RUNNING órfãos
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.disparoJob.updateMany({
      where: { status: "RUNNING", atualizadoEm: { lt: staleCutoff } },
      data: { status: "QUEUED" },
    });

    const pendentes = await prisma.disparoJob.groupBy({
      by: ["organizationId"],
      where: { status: "QUEUED" },
      _count: true,
    });

    for (const p of pendentes) {
      const organizationId = p.organizationId;

      // Reconstrói contexto respeitando os mesmos gates do disparo normal
      const config = await prisma.disparoConfig.findUnique({ where: { organizationId } });
      if (!config || config.pausadoManualmente || !dentroJanela(config)) continue;

      const providerConfig = await prisma.whatsappProviderConfig.findFirst({ where: { organizationId } });
      const token = providerConfig?.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
      const template = await prisma.templateProspeccao.findFirst({ where: { organizationId, ativo: true } });
      if (!providerConfig || !token || !template) continue;

      console.log(`[Disparo] Retomando ${p._count} jobs pendentes da org ${organizationId}`);
      await processarFilaDisparo(organizationId, { config, providerConfig, token, template });
    }
  } catch (e) {
    console.error("[Disparo] Erro na retomada:", e);
  } finally {
    retomadaAtiva = false;
  }
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
