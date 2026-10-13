// Parser do `referral` que a Meta manda na primeira mensagem de quem clicou num
// anúncio Click-to-WhatsApp (webhook messages[].referral). Função pura.

export interface ReferralBruto {
  source_id?: unknown;
  source_type?: unknown;
  source_url?: unknown;
  headline?: unknown;
  body?: unknown;
  ctwa_clid?: unknown;
  media_type?: unknown;
  image_url?: unknown;
  video_url?: unknown;
  thumbnail_url?: unknown;
}

export interface OrigemAnuncio {
  ctwaClid: string | null;
  adSourceId: string | null;
  adSourceType: string | null;
  adHeadline: string | null;
  adBody: string | null;
  adSourceUrl: string | null;
}

function texto(v: unknown, max = 500): string | null {
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Extrai a origem do anúncio de uma mensagem do webhook.
 * Devolve null quando não há `referral` (a grande maioria das mensagens) ou
 * quando ele não traz nada aproveitável.
 */
export function parseReferral(message: { referral?: unknown } | null | undefined): OrigemAnuncio | null {
  const r = message?.referral;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const b = r as ReferralBruto;

  const origem: OrigemAnuncio = {
    ctwaClid: texto(b.ctwa_clid, 500),
    adSourceId: texto(b.source_id, 100),
    adSourceType: texto(b.source_type, 30),
    adHeadline: texto(b.headline, 300),
    adBody: texto(b.body, 1000),
    adSourceUrl: texto(b.source_url, 1000),
  };
  const algo = origem.ctwaClid || origem.adSourceId || origem.adHeadline || origem.adSourceUrl;
  return algo ? origem : null;
}
