// GET /api/prospeccao/disparo/template-meta/:organizationId
// Consulta a estrutura REAL dos templates na Meta (Graph API) e compara com o
// que está cadastrado no banco — mostra quantos parâmetros o template espera de
// verdade. Diagnóstico do erro #132000 (número de parâmetros não bate).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { resolverWaba } from "@/lib/prospeccao/meta-waba";

const GRAPH = "https://graph.facebook.com/v20.0";

type MetaComponent = {
  type: string;               // BODY | HEADER | FOOTER | BUTTONS
  text?: string;
  example?: { body_text?: string[][]; header_text?: string[] };
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  const resolucao = await resolverWaba(organizationId);
  if (!resolucao.ok) {
    return NextResponse.json(
      { error: resolucao.error, debug: resolucao.debug },
      { status: resolucao.status },
    );
  }
  const { wabaId, token, providerId } = resolucao.waba;

  const templatesBanco = await prisma.templateProspeccao.findMany({
    where: { organizationId },
    select: { id: true, nomeTemplateMeta: true, idioma: true, variaveis: true, ativo: true },
  });

  // Busca todos os templates da WABA resolvida na Meta
  let metaTemplates: Array<{ name: string; language: string; status: string; components: MetaComponent[] }> = [];
  try {
    const res = await fetch(
      `${GRAPH}/${wabaId}/message_templates?fields=name,language,status,components&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `Meta API ${res.status}`, detalhe: await res.text(), wabaId }, { status: 502 });
    }
    const data = await res.json() as { data?: typeof metaTemplates };
    metaTemplates = data.data ?? [];
  } catch (e) {
    return NextResponse.json({ error: "falha ao consultar Meta", detalhe: String(e) }, { status: 502 });
  }

  // Cruza cada template do banco com a definição real na Meta e GRAVA o corpo real
  const analise = [];
  for (const tb of templatesBanco) {
    const meta = metaTemplates.find((m) => m.name === tb.nomeTemplateMeta);
    if (!meta) {
      analise.push({
        nome: tb.nomeTemplateMeta,
        ativo: tb.ativo,
        problema: "NÃO EXISTE na Meta com esse nome (ou não aprovado nesta WABA)",
        variaveisBanco: tb.variaveis,
      });
      continue;
    }
    const body = meta.components.find((c) => c.type === "BODY");
    const corpo = body?.text ?? null;
    const placeholders = corpo ? (corpo.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length : 0;
    const esperadoMeta = body?.example?.body_text?.[0]?.length ?? placeholders;

    // Grava o corpo real (e ajusta a contagem de variáveis) no template
    await prisma.templateProspeccao.update({
      where: { id: tb.id },
      data: {
        corpoTexto: corpo,
        ...(esperadoMeta !== tb.variaveis.length ? { variaveis: tb.variaveis.slice(0, esperadoMeta) } : {}),
      },
    }).catch(() => {});

    // Backfill: corrige mensagens antigas que ficaram com o placeholder
    // (conversas criadas antes de termos o corpo real). Template estático → texto direto.
    let mensagensCorrigidas = 0;
    if (corpo && esperadoMeta === 0) {
      const upd = await prisma.whatsappMessage.updateMany({
        where: {
          content: { startsWith: `📤 Abordagem enviada (template "${tb.nomeTemplateMeta}"` },
          conversation: { whatsappProviderConfigId: providerId },
        },
        data: { content: corpo },
      }).catch(() => ({ count: 0 }));
      mensagensCorrigidas = upd.count;
    }

    analise.push({
      nome: tb.nomeTemplateMeta,
      idioma: `${tb.idioma} (Meta: ${meta.language})`,
      status: meta.status,
      ativo: tb.ativo,
      corpoTemplate: corpo ?? "(sem corpo)",
      parametrosEsperadosPelaMeta: esperadoMeta,
      parametrosEnviadosPeloBanco: tb.variaveis.length,
      corpoGravado: Boolean(corpo),
      mensagensAntigasCorrigidas: mensagensCorrigidas,
    });
  }

  return NextResponse.json({
    wabaId,
    totalTemplatesMeta: metaTemplates.length,
    nomesNaMeta: metaTemplates.map((m) => `${m.name} [${m.status}]`),
    analise,
  });
}
