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

  // Resolve o WABA real. O campo pode estar vazio/placeholder (DEMO_WABA_ID) —
  // nesse caso pergunta à Meta a qual WABA o phone number pertence e grava.
  let wabaId = provider.wabaId;
  if (!wabaId || wabaId === "DEMO_WABA_ID") {
    try {
      const r = await fetch(
        `${GRAPH}/${provider.businessPhoneNumberId}?fields=whatsapp_business_account`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) {
        const j = await r.json() as { whatsapp_business_account?: { id?: string } };
        const resolved = j.whatsapp_business_account?.id;
        if (resolved) {
          wabaId = resolved;
          await prisma.whatsappProviderConfig.update({
            where: { id: provider.id },
            data: { wabaId: resolved },
          }).catch(() => {});
        }
      }
    } catch { /* segue com o que tiver */ }
  }

  if (!wabaId || wabaId === "DEMO_WABA_ID") {
    return NextResponse.json({
      error: "não consegui resolver o WABA ID a partir do phone number — verifique o token/permissões",
      phoneNumberId: provider.businessPhoneNumberId,
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
