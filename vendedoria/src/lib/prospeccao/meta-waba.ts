import { prisma } from "@/lib/prisma/client";

// Resolução do WABA (WhatsApp Business Account) real por trás de uma organização —
// extraído do diagnóstico de templates pra ser reaproveitado também na criação de
// templates novos. Mesmo algoritmo: debug_token → negócios → páginas, até achar
// a WABA que contém o phone number configurado.

const GRAPH = "https://graph.facebook.com/v20.0";

export interface WabaResolvida {
  wabaId: string;
  token: string;
  providerId: string;
  businessPhoneNumberId: string;
}

export type ResultadoWaba =
  | { ok: true; waba: WabaResolvida }
  | { ok: false; error: string; status: number; debug?: Record<string, unknown> };

export async function resolverWaba(organizationId: string): Promise<ResultadoWaba> {
  const provider = await prisma.whatsappProviderConfig.findFirst({ where: { organizationId } });
  if (!provider) {
    return { ok: false, error: "sem WhatsappProviderConfig", status: 404 };
  }

  const token = provider.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, error: "sem access token", status: 400 };
  }

  const gget = async (path: string): Promise<Record<string, unknown>> => {
    try {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`);
      return await r.json() as Record<string, unknown>;
    } catch (e) { return { error: String(e) }; }
  };

  const debug: Record<string, unknown> = {};
  let wabaId = provider.wabaId && provider.wabaId !== "DEMO_WABA_ID" ? provider.wabaId : null;

  if (!wabaId) {
    const candidatos = new Set<string>();

    if (process.env.META_WHATSAPP_WABA_ID) candidatos.add(process.env.META_WHATSAPP_WABA_ID);

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

    const bizs = await gget("me/businesses?fields=id,name&limit=50");
    debug.businesses = bizs;
    for (const b of (bizs.data as Array<{ id: string }> | undefined) ?? []) {
      for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const w = await gget(`${b.id}/${edge}?fields=id,name&limit=50`);
        for (const wa of (w.data as Array<{ id: string }> | undefined) ?? []) candidatos.add(wa.id);
      }
    }

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

    for (const cand of candidatos) {
      const phones = await gget(`${cand}/phone_numbers?fields=id&limit=50`);
      const temNosso = ((phones.data as Array<{ id: string }> | undefined) ?? [])
        .some((p) => p.id === provider.businessPhoneNumberId);
      if (temNosso) { wabaId = cand; break; }
    }
    if (!wabaId && candidatos.size === 1) wabaId = [...candidatos][0];

    if (wabaId) {
      await prisma.whatsappProviderConfig.update({
        where: { id: provider.id }, data: { wabaId },
      }).catch(() => {});
    }
  }

  if (!wabaId) {
    return { ok: false, error: "não consegui achar o WABA que contém este número — veja os candidatos no debug", status: 400, debug };
  }

  return {
    ok: true,
    waba: { wabaId, token, providerId: provider.id, businessPhoneNumberId: provider.businessPhoneNumberId },
  };
}
