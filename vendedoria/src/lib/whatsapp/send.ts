const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function resolveToken(override?: string): string | undefined {
  return override ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
}

/**
 * Brazilian mobile numbers migrated to 9 digits in 2012.
 * WhatsApp sometimes delivers the old 8-digit format (55XX8digits).
 * Meta's send API requires the 9-digit format (55XX9 8digits).
 * Exported so the webhook can normalise phone numbers at storage time too.
 */
export function normalizeBrazilianNumber(phone: string): string {
  if (/^55\d{10}$/.test(phone)) {
    const areaCode = phone.slice(2, 4);
    const number = phone.slice(4);
    if (/^[6-9]/.test(number)) return `55${areaCode}9${number}`;
  }
  return phone;
}

/** Mark an incoming message as read — shows blue double-tick to customer */
export async function markWhatsAppMessageRead(
  phoneNumberId: string,
  messageId: string,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;
  await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => {}); // best-effort
}

/**
 * Simulate human "typing" — marks message as read then waits.
 * Delay is proportional to response length: feels natural, not instant.
 */
export async function simulateTypingDelay(
  phoneNumberId: string,
  incomingMessageId: string,
  responseText: string,
  accessToken?: string
): Promise<void> {
  // Mark as read immediately (customer sees blue ticks — agent "read" the message)
  await markWhatsAppMessageRead(phoneNumberId, incomingMessageId, accessToken);

  // Typing delay: ~30ms per character, clamped between 1.5s and 6s
  const ms = Math.min(Math.max(responseText.length * 30, 1500), 6000);
  await new Promise((r) => setTimeout(r, ms));
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string,
  contextMessageId?: string  // reply-to: quotes this message in WhatsApp
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) {
    console.warn("[WhatsApp] No access token configured — skipping send");
    return;
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeBrazilianNumber(to),
    type: "text",
    text: { body: text },
  };

  if (contextMessageId) body.context = { message_id: contextMessageId };

  const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[WhatsApp] Send error:", error);
    throw new Error(`WhatsApp send failed: ${error}`);
  }
}

export async function sendWhatsAppImage(
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string,
  accessToken?: string,
  contextMessageId?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) { console.error("[sendWhatsAppImage] No access token"); return; }

  if (imageUrl.startsWith("data:")) {
    throw new Error("sendWhatsAppImage: URL is base64 — use Cloudinary URL instead");
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeBrazilianNumber(to),
    type: "image",
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  };
  if (contextMessageId) body.context = { message_id: contextMessageId };

  console.log(`[sendWhatsAppImage] phoneId=${phoneNumberId} to=${to} url=${imageUrl.substring(0, 80)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    console.log(`[sendWhatsAppImage] status=${response.status} body=${responseText.substring(0, 200)}`);
    if (!response.ok) throw new Error(`WhatsApp image send failed (${response.status}): ${responseText}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWhatsAppVideo(
  phoneNumberId: string,
  to: string,
  videoUrl: string,
  caption?: string,
  accessToken?: string,
  contextMessageId?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) { console.error("[sendWhatsAppVideo] No access token"); return; }

  if (videoUrl.startsWith("data:")) {
    throw new Error("sendWhatsAppVideo: URL is base64 — use Cloudinary URL instead");
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeBrazilianNumber(to),
    type: "video",
    video: { link: videoUrl, ...(caption ? { caption } : {}) },
  };
  if (contextMessageId) body.context = { message_id: contextMessageId };

  console.log(`[sendWhatsAppVideo] phoneId=${phoneNumberId} to=${to} url=${videoUrl.substring(0, 80)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    console.log(`[sendWhatsAppVideo] status=${response.status} body=${responseText.substring(0, 200)}`);
    if (!response.ok) throw new Error(`WhatsApp video send failed (${response.status}): ${responseText}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string = "pt_BR",
  components: unknown[] = [],
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;

  const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });

  if (!response.ok) throw new Error(`WhatsApp template send failed: ${await response.text()}`);
}

export async function getPhoneNumberInfo(phoneNumberId: string): Promise<{
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
}> {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("No access token");

  const response = await fetch(
    `${BASE_URL}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) throw new Error("Failed to get phone info");
  return response.json();
}
