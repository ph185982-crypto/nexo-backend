// GET /api/meta/capi/diagnostico — confere a configuração da API de Conversões
// e compara o WABA configurado no banco com o esperado (META_WABA_ID).
// Somente leitura; nunca devolve valores de segredo (só se estão definidos).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { lerConfigCapi } from "@/lib/meta-capi";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cfg = lerConfigCapi();
  const provedores = await prisma.whatsappProviderConfig.findMany({
    select: { id: true, organizationId: true, businessPhoneNumberId: true, wabaId: true, status: true },
  });
  const esperado = cfg.wabaId ?? null;
  return NextResponse.json({
    config: {
      META_CAPI_TOKEN: Boolean(cfg.token),
      META_DATASET_ID: Boolean(cfg.datasetId),
      META_WABA_ID: Boolean(cfg.wabaId),
      META_PAGE_ID: Boolean(cfg.pageId),
      META_GRAPH_VERSION: cfg.graphVersion,
      META_TEST_EVENT_CODE: Boolean(cfg.testEventCode),
      META_CAPI_DRY_RUN: cfg.dryRun,
      page_id_no_payload: cfg.enviarPageId,
    },
    provedoresWhatsapp: provedores.map((p) => ({
      ...p,
      confere: esperado ? p.wabaId === esperado : null,
    })),
    aviso: esperado && provedores.some((p) => p.wabaId !== esperado)
      ? "O WABA do provedor no banco é diferente de META_WABA_ID. Nada foi alterado."
      : null,
  });
}
