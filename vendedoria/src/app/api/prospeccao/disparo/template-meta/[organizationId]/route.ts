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

    // 1. via negócios do token
    const bizs = await gget("me/businesses?fields=id,name&limit=50");
    debug.businesses = bizs;
    for (const b of (bizs.data as Array<{ id: string }> | undefined) ?? []) {
      for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const w = await gget(`${b.id}/${edge}?fields=id,name&limit=50`);
        for (const wa of (w.data as Array<{ id: string }> | undefined) ?? []) candidatos.add(wa.id);
      }
    }

    // 2. via páginas do token (Página FB conectada a uma WABA)
    const pages = await gget("me/accounts?fields=id,name&limit=50");
    debug.pages = (pages.data as Array<{ id: string; name: string }> | undefined)?.map((p) => p.name) ?? pages;
    for (const p of (pages.data as Array<{ id: string }> | undefined) ?? []) {
      const wa = await gget(`${p.id}?fields=whatsapp_business_account{id,name}`);
      const id = (wa.whatsapp_business_account as { id?: string } | undefined)?.id;
      if (id) candidatos.add(id);
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
    select: { nomeTemplateMeta: true, idioma: true, variaveis: true, ativo: true },
  });

  // Busca todos os templates da WABA na Meta
  let metaTemplates: Array<{ name: string; language: string; status: string; components: MetaComponent[] }> = [];
  try {
    const res = await fetch(
      `${GRAPH}/${provider.wabaId}/message_templates?fields=name,language,status,components&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `Meta API ${res.status}`, detalhe: await res.text() }, { status: 502 });
    }
    const data = await res.json() as { data?: typeof metaTemplates };
    metaTemplates = data.data ?? [];
  } catch (e) {
    return NextResponse.json({ error: "falha ao consultar Meta", detalhe: String(e) }, { status: 502 });
  }

  // Cruza cada template do banco com a definição real na Meta
  const analise = templatesBanco.map((tb) => {
    const meta = metaTemplates.find((m) => m.name === tb.nomeTemplateMeta);
    if (!meta) {
      return {
        nome: tb.nomeTemplateMeta,
        ativo: tb.ativo,
        problema: "NÃO EXISTE na Meta com esse nome (ou não aprovado nesta WABA)",
        variaveisBanco: tb.variaveis,
      };
    }
    const body = meta.components.find((c) => c.type === "BODY");
    // Conta placeholders {{n}} no corpo real do template
    const placeholders = body?.text ? (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length : 0;
    const esperadoMeta = body?.example?.body_text?.[0]?.length ?? placeholders;
    const enviadoBanco = tb.variaveis.length;

    return {
      nome: tb.nomeTemplateMeta,
      idioma: `${tb.idioma} (Meta: ${meta.language})`,
      status: meta.status,
      ativo: tb.ativo,
      corpoTemplate: body?.text ?? "(sem corpo)",
      parametrosEsperadosPelaMeta: esperadoMeta,
      parametrosEnviadosPeloBanco: enviadoBanco,
      variaveisBanco: tb.variaveis,
      bate: esperadoMeta === enviadoBanco,
      problema: esperadoMeta === enviadoBanco
        ? null
        : `MISMATCH: Meta espera ${esperadoMeta} parâmetro(s), banco envia ${enviadoBanco}. ` +
          (esperadoMeta === 0
            ? "O template não tem variáveis — remova todas as variáveis no cadastro."
            : `Ajuste as variáveis no banco para exatamente ${esperadoMeta} item(ns).`),
    };
  });

  return NextResponse.json({
    wabaId: provider.wabaId,
    totalTemplatesMeta: metaTemplates.length,
    nomesNaMeta: metaTemplates.map((m) => `${m.name} [${m.status}]`),
    analise,
  });
}
