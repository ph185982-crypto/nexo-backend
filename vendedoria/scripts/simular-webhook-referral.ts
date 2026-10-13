/**
 * Simula a Meta enviando ao webhook do WhatsApp a 1ª mensagem de quem clicou num
 * anúncio Click-to-WhatsApp (com `referral`). Assina o corpo com HMAC-SHA256 como a
 * Meta faz — o segredo vem de META_WHATSAPP_APP_SECRET (nunca é impresso).
 *
 * Uso (contra o preview ou localhost):
 *   META_WHATSAPP_APP_SECRET=... npx tsx scripts/simular-webhook-referral.ts \
 *     --url https://SEU-PREVIEW.vercel.app --phone-number-id 1009631782242056 \
 *     [--from 5562999990000] [--ctwa-clid CLID] [--ad-id 1202...] [--headline "Título"] \
 *     [--text "Oi, vi o anúncio"] [--sem-referral]
 *
 * Preview com "Vercel Authentication": defina VERCEL_AUTOMATION_BYPASS_SECRET (o
 * valor é enviado no header x-vercel-protection-bypass, nunca impresso).
 *
 * Atenção: use um número de teste. A mensagem é gravada de verdade no banco
 * apontado pelo deploy (cria lead/conversa) e, se o agente de IA estiver ativo,
 * ele responde ao número simulado.
 */
import { createHmac, randomUUID } from "crypto";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(`--${nome}`);

async function main() {
  const base = (arg("url") ?? "").replace(/\/+$/, "");
  const phoneNumberId = arg("phone-number-id");
  if (!base || !phoneNumberId) {
    console.error("Uso: --url <https://preview> --phone-number-id <id do número WhatsApp Business> [--from ...]");
    process.exit(1);
  }
  const segredo = process.env.META_WHATSAPP_APP_SECRET;
  if (!segredo) {
    console.error("Defina META_WHATSAPP_APP_SECRET (o mesmo do deploy) para assinar o corpo.");
    process.exit(1);
  }

  const from = arg("from") ?? `55629${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const message: Record<string, unknown> = {
    from,
    id: `wamid.SIM${randomUUID().replace(/-/g, "")}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text",
    text: { body: arg("text") ?? "Olá, vi o anúncio e quero saber mais" },
  };
  if (!tem("sem-referral")) {
    message.referral = {
      source_url: "https://fb.me/simulado",
      source_id: arg("ad-id") ?? "120210000000000001",
      source_type: "ad",
      headline: arg("headline") ?? "Anúncio de teste (simulado)",
      body: "Corpo do anúncio de teste",
      media_type: "image",
      ctwa_clid: arg("ctwa-clid") ?? `SIM_CLID_${Date.now()}`,
    };
  }

  const corpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: arg("waba-id") ?? "3170296709806629",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "556293250802", phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: "Lead Simulado" }, wa_id: from }],
          messages: [message],
        },
      }],
    }],
  });
  const assinatura = "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");

  const headers: Record<string, string> = { "Content-Type": "application/json", "x-hub-signature-256": assinatura };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const res = await fetch(`${base}/api/webhooks/whatsapp`, { method: "POST", headers, body: corpo });
  console.log(`POST ${base}/api/webhooks/whatsapp → HTTP ${res.status}`);
  console.log(`corpo: ${(await res.text()).slice(0, 300)}`);
  console.log(`from=${from} | referral=${tem("sem-referral") ? "não" : "sim"}`);
  console.log("Confira em /crm/lead/kanban (card com 📣) e /crm/anuncios.");
  if (!res.ok) process.exit(2);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
