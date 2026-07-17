// GET /api/prospeccao/disparo/template-meta/:organizationId
// Consulta a estrutura REAL dos templates na Meta (Graph API) e compara com o
// que está cadastrado no banco — mostra quantos parâmetros o template espera de
// verdade. Diagnóstico do erro #132000 (número de parâmetros não bate).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

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

  const provider = await prisma.whatsappProviderConfig.findFirst({ where: { organizationId } });
  if (!provider) {
    return NextResponse.json({ error: "sem WhatsappProviderConfig" }, { status: 404 });
  }

  const token = provider.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "sem access token" }, { status: 400 });
  }

  const gget = async (path: string): Promise<Record<string, unknown>> => {
    try {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`);
      return await r.json() as Record<string, unknown>;
    } catch (e) { return { error: String(e) }; }
  };

  // Resolve o WABA real percorrendo os negócios do token e achando o WABA que
  // contém o phone number desta org. Grava de volta no provider.
  const debug: Record<string, unknown> = {};
  let wabaId = provider.wabaId && provider.wabaId !== "DEMO_WABA_ID" ? provider.wabaId : null;

  if (!wabaId) {
    const candidatos = new Set<string>();

    // 0. env explícita
    if (process.env.META_WHATSAPP_WABA_ID) candidatos.add(process.env.META_WHATSAPP_WABA_ID);

    // 0b. MÉTODO CANÔNICO: debug_token revela os WABAs nos granular_scopes do token.
    //     Usa o app token ({app_id}|{app_secret}) para inspecionar o token do usuário.
    const appId = process.env.META_WHATSAPP_APP_ID;
    const appSecret = process.env.META_WHATSAPP_APP_SECRET;
    if (appId && appSecret) {
      const dbg = await gget(`debug_token?input_token=${token}&access_token=${appId}|${appSecret}`);
      const scopes = ((dbg.data as { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } | undefined)?.granular_scopes) ?? [];
      debug.granularScopes = scopes.map((s) => s.scope);
      for (const s of scopes) {
        if (s.scope.includes("whatsapp_business")) {
          for (const id of s.target_ids ?? []) candidatos.add(id);
        }
      }
    }

    // 1. via negócios do token
    const bizs = await gget("me/businesses?fields=id,name&limit=50");
    debug.businesses = bizs;
    for (const b of (bizs.data as Array<{ id: string }> | undefined) ?? []) {
      for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const w = await gget(`${b.id}/${edge}?fields=id,name&limit=50`);
        for (const wa of (w.data as Array<{ id: string }> | undefined) ?? []) candidatos.add(wa.id);
      }
    }

    // 2. via páginas do token — usa o TOKEN DA PÁGINA (mais permissivo) p/ ler a WABA
    const pages = await gget("me/accounts?fields=id,name,access_token&limit=50");
    debug.pages = (pages.data as Array<{ id: string; name: string }> | undefined)?.map((p) => p.name) ?? pages;
    for (const p of (pages.data as Array<{ id: string; access_token?: string }> | undefined) ?? []) {
      const pageToken = p.access_token ?? token;
      for (const field of ["whatsapp_business_account", "owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        try {
          const r = await fetch(`${GRAPH}/${p.id}?fields=${field}{id,name}&access_token=${pageToken}`);
          const wa = await r.json() as Record<string, unknown>;
          const direct = (wa[field] as { id?: string } | undefined)?.id;
          if (direct) candidatos.add(direct);
          for (const x of (wa[field] as { data?: Array<{ id: string }> } | undefined)?.data ?? []) candidatos.add(x.id);
        } catch { /* ignora */ }
      }
    }

    debug.wabaCandidatos = [...candidatos];

    // Acha o WABA que tem o nosso phone number
    for (const cand of candidatos) {
      const phones = await gget(`${cand}/phone_numbers?fields=id&limit=50`);
      const temNosso = ((phones.data as Array<{ id: string }> | undefined) ?? [])
        .some((p) => p.id === provider.businessPhoneNumberId);
      if (temNosso) { wabaId = cand; break; }
    }
    // Se não casou pelo phone, mas só há 1 candidato, usa ele
    if (!wabaId && candidatos.size === 1) wabaId = [...candidatos][0];

    if (wabaId) {
      await prisma.whatsappProviderConfig.update({
        where: { id: provider.id }, data: { wabaId },
      }).catch(() => {});
    }
  }

  if (!wabaId) {
    return NextResponse.json({
      error: "não consegui achar o WABA que contém este número — veja os candidatos no debug",
      phoneNumberId: provider.businessPhoneNumberId,
      debug,
    }, { status: 400 });
  }

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
      return NextResponse.json({ error: `Meta API ${res.status}`, detalhe: await res.text(), wabaId, debug }, { status: 502 });
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
          conversation: { whatsappProviderConfigId: provider.id },
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
