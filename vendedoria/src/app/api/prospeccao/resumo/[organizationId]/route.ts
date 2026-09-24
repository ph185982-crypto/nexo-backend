// GET /api/prospeccao/resumo/:organizationId
// Tudo que o hub de Prospecção precisa numa chamada: contagem por etapa, cada
// busca com seu progresso, KPIs, próximos passos sugeridos e alertas do disparo.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { ETAPAS, STATUS_INFO, isStatus, type EtapaId } from "@/lib/prospeccao/status";
import { getHoraBRT } from "@/lib/prospeccao/disparo";

type ContagemEtapas = Record<EtapaId, number>;

function etapasVazias(): ContagemEtapas {
  return { qualificar: 0, revisar: 0, abordar: 0, conversando: 0, ganhos: 0, encerrado: 0 };
}

interface Passo {
  id: string;
  prioridade: number;
  titulo: string;
  descricao: string;
  acao: { label: string; aba: string; segmentId?: string; executar?: "pipeline" | "sourcing" };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { organizationId } = await params;

  const [segmentos, grupos, abordados, runsAtivas, config, template, provider] = await Promise.all([
    prisma.prospectSegment.findMany({
      where: { organizationId, ativo: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.prospectLead.groupBy({
      by: ["segmentId", "status"],
      where: { organizationId },
      _count: { _all: true },
    }),
    prisma.prospectLead.count({ where: { organizationId, dataAbordagem: { not: null } } }),
    prisma.sourcingRun.findMany({
      where: { status: "EXECUTANDO", segment: { organizationId } },
      orderBy: { iniciadoEm: "desc" },
    }),
    prisma.disparoConfig.findUnique({ where: { organizationId } }),
    prisma.templateProspeccao.findFirst({ where: { organizationId, ativo: true }, select: { nomeTemplateMeta: true } }),
    prisma.whatsappProviderConfig.findFirst({ where: { organizationId }, select: { status: true } }),
  ]);

  const porStatus: Record<string, number> = {};
  const etapas = etapasVazias();
  const porSegmento = new Map<string, { etapas: ContagemEtapas; porStatus: Record<string, number>; total: number }>();

  for (const g of grupos) {
    const n = g._count._all;
    porStatus[g.status] = (porStatus[g.status] ?? 0) + n;
    const etapa: EtapaId = isStatus(g.status) ? STATUS_INFO[g.status].etapa : "encerrado";
    etapas[etapa] += n;
    if (g.segmentId) {
      const s = porSegmento.get(g.segmentId) ?? { etapas: etapasVazias(), porStatus: {}, total: 0 };
      s.etapas[etapa] += n;
      s.porStatus[g.status] = (s.porStatus[g.status] ?? 0) + n;
      s.total += n;
      porSegmento.set(g.segmentId, s);
    }
  }

  const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
  const st = (k: string) => porStatus[k] ?? 0;
  const reunioes = st("REUNIAO_AGENDADA");
  const qualificados = st("QUALIFICADO") + reunioes;
  const responderam = st("RESPONDEU") + qualificados;

  const buscas = segmentos.map((seg) => {
    const c = porSegmento.get(seg.id) ?? { etapas: etapasVazias(), porStatus: {}, total: 0 };
    const run = runsAtivas.find((r) => r.segmentId === seg.id);
    return {
      id: seg.id,
      nome: seg.nome,
      termoBusca: seg.termoBusca,
      termosSecundarios: seg.termosSecundarios,
      cidades: seg.cidades,
      apenasCelular: seg.apenasCelular,
      filtroSite: seg.filtroSite,
      metaEmpresas: seg.metaEmpresas,
      limiarScoreQualificado: seg.limiarScoreQualificado,
      pesoSemSite: seg.pesoSemSite,
      pesoSemAnuncioAtivo: seg.pesoSemAnuncioAtivo,
      pesoInstagramParado: seg.pesoInstagramParado,
      pesoRatingBaixo: seg.pesoRatingBaixo,
      createdAt: seg.createdAt,
      total: c.total,
      etapas: c.etapas,
      porStatus: c.porStatus,
      buscando: run ? { inseridos: run.inseridos, meta: run.meta, iniciadoEm: run.iniciadoEm } : null,
    };
  });

  // ── Alertas do disparo ──
  const alertas: Array<{ tipo: "erro" | "aviso"; msg: string }> = [];
  if (!template) alertas.push({ tipo: "erro", msg: "Nenhum template de mensagem ativo — cadastre um na aba Disparo." });
  if (!provider) alertas.push({ tipo: "erro", msg: "Nenhum número de WhatsApp conectado a esta organização." });
  else if (provider.status === "ERROR" || provider.status === "BANNED") {
    alertas.push({ tipo: "erro", msg: `Número de WhatsApp com problema (status ${provider.status}).` });
  }
  if (config?.pausadoManualmente) {
    alertas.push({ tipo: "aviso", msg: `Disparo pausado${config.motivoPausa ? `: ${config.motivoPausa}` : ""}.` });
  }
  const { hora, diaSemana } = getHoraBRT();
  const inicio = config?.janelaInicioHora ?? 9;
  const fim = config?.janelaFimHora ?? 18;
  const dias = config?.diasSemana ?? [1, 2, 3, 4, 5];
  const dentroJanela = dias.includes(diaSemana) && hora >= inicio && hora < fim;
  const fixosAprovados = await prisma.prospectLead.count({
    where: { organizationId, status: "APROVADO", tipoTelefone: "FIXO" },
  });
  if (fixosAprovados > 0) {
    alertas.push({ tipo: "aviso", msg: `${fixosAprovados} empresa(s) aprovada(s) têm telefone fixo e não recebem WhatsApp.` });
  }

  // ── Próximos passos ──
  const passos: Passo[] = [];
  if (buscas.length === 0) {
    passos.push({
      id: "primeira-busca", prioridade: 0,
      titulo: "Crie sua primeira busca",
      descricao: "Escolha segmentos e cidades — encontramos as empresas no Google Maps para você.",
      acao: { label: "Nova busca", aba: "buscas" },
    });
  }
  for (const b of buscas) {
    if (b.buscando) continue;
    if (b.total === 0) {
      passos.push({
        id: `buscar-${b.id}`, prioridade: 1,
        titulo: `"${b.nome}" ainda não tem empresas`,
        descricao: "Rode a busca para encontrar empresas deste segmento.",
        acao: { label: "Buscar empresas", aba: "buscas", segmentId: b.id, executar: "sourcing" },
      });
    } else if (b.etapas.qualificar > 0) {
      passos.push({
        id: `qualificar-${b.id}`, prioridade: 2,
        titulo: `${b.etapas.qualificar} empresa(s) de "${b.nome}" para qualificar`,
        descricao: "A IA verifica site, anúncios e Instagram, calcula o score e decide quem vale abordar.",
        acao: { label: "Qualificar agora", aba: "buscas", segmentId: b.id, executar: "pipeline" },
      });
    }
  }
  if (etapas.revisar > 0) {
    passos.push({
      id: "revisar", prioridade: 3,
      titulo: `${etapas.revisar} empresa(s) aguardando sua revisão`,
      descricao: "A IA ficou em dúvida sobre estas. Aprove ou descarte em poucos cliques.",
      acao: { label: "Revisar", aba: "revisao" },
    });
  }
  const prontas = st("APROVADO") - fixosAprovados;
  if (prontas > 0) {
    passos.push({
      id: "disparar", prioridade: 4,
      titulo: `${prontas} empresa(s) prontas para abordagem`,
      descricao: template
        ? dentroJanela
          ? `Template "${template.nomeTemplateMeta}" ativo. Dentro da janela de envio.`
          : `Fora da janela de envio agora (${inicio}h–${fim}h). O disparo automático roda no próximo horário comercial.`
        : "Ative um template de mensagem antes de disparar.",
      acao: { label: "Ir para disparo", aba: "disparo" },
    });
  }
  if (st("RESPONDEU") > 0) {
    passos.push({
      id: "responderam", prioridade: 5,
      titulo: `${st("RESPONDEU")} empresa(s) responderam`,
      descricao: "Acompanhe as conversas — o agente SDR está conduzindo, mas vale dar uma olhada.",
      acao: { label: "Ver empresas", aba: "empresas" },
    });
  }
  passos.sort((a, b) => a.prioridade - b.prioridade);

  return NextResponse.json({
    etapas,
    etapasDef: ETAPAS,
    porStatus,
    kpis: {
      total,
      aprovadas: st("APROVADO"),
      abordados,
      responderam,
      qualificados,
      reunioes,
      taxaResposta: abordados > 0 ? responderam / abordados : 0,
      taxaReuniao: abordados > 0 ? reunioes / abordados : 0,
    },
    buscas,
    passos,
    alertas,
    disparo: {
      pausado: Boolean(config?.pausadoManualmente),
      dentroJanela,
      janela: `${inicio}h–${fim}h`,
      limiteDiario: config?.limiteDiarioAtual ?? 15,
      template: template?.nomeTemplateMeta ?? null,
    },
  });
}
