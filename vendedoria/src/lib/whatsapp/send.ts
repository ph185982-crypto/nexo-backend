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
  const digits = phone.replace(/\D/g, "");
  if (/^55\d{10}$/.test(digits)) {
    const areaCode = digits.slice(2, 4);
    const number = digits.slice(4);
    if (/^[6-9]/.test(number)) return `55${areaCode}9${number}`;
  }
  return digits || phone;
}

/**
 * Chave canônica de um número brasileiro: só dígitos, sem o 55 e sem o 9º
 * dígito — sempre DDD + 8 dígitos.
 *
 * `normalizeBrazilianNumber` é de mão única (só ACRESCENTA o 9), então dois
 * registros do mesmo cliente em formatos diferentes ("556284465388" vindo de
 * importação e "5562984465388" vindo do WhatsApp) nunca se encontravam e
 * viravam leads duplicados no Kanban. Comparar sempre pela forma canônica.
 */
export function canonicalBrazilianNumber(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);
  if (n.length === 11 && n[2] === "9") n = n.slice(0, 2) + n.slice(3);
  return n;
}

/**
 * Todas as grafias plausíveis de um número, para consultar registros gravados
 * antes da normalização virar padrão (com/sem 55, com/sem o 9º dígito).
 */
export function brazilianNumberVariants(phone: string): string[] {
  const canonical = canonicalBrazilianNumber(phone); // DDD + 8
  if (canonical.length !== 10) {
    const digits = phone.replace(/\D/g, "");
    return Array.from(new Set([phone, digits].filter(Boolean)));
  }
  const ddd = canonical.slice(0, 2);
  const eightDigits = canonical.slice(2);
  const nineDigits = `9${eightDigits}`;
  return Array.from(new Set([
    `55${ddd}${nineDigits}`, // 13 dígitos — formato atual da Meta
    `55${ddd}${eightDigits}`, // 12 dígitos — legado
    `${ddd}${nineDigits}`,    // sem código do país
    canonical,
    phone,
  ].filter(Boolean)));
}

/**
 * Show "digitando..." (typing) indicator in WhatsApp and wait proportionally.
 * Uses Meta's `typing_on` action from the unofficial but functional endpoint.
 * Falls back silently if the API rejects — the delay alone humanizes the UX.
 */
export async function sendTypingIndicator(
  phoneNumberId: string,
  to: string,
  durationMs: number,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;

  const sendTypingOn = () =>
    fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeBrazilianNumber(to),
        typing: { action: "typing_on" },
      }),
    }).catch(() => {});

  const clamped = Math.min(durationMs, 8000);
  await sendTypingOn();

  // WhatsApp typing indicator expires ~5s on client — refresh at 4s for longer delays
  if (clamped > 4500) {
    await new Promise((r) => setTimeout(r, 4000));
    await sendTypingOn();
    await new Promise((r) => setTimeout(r, clamped - 4000));
  } else {
    await new Promise((r) => setTimeout(r, clamped));
  }
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
 * Simulate human "typing" before a bubble.
 * Marks message as read (blue ticks), sends typing_on indicator, then waits.
 * Delay is proportional to the text length: feels natural, not instant.
 */
export async function simulateTypingDelay(
  phoneNumberId: string,
  incomingMessageId: string,
  responseText: string,
  to: string,
  accessToken?: string
): Promise<void> {
  // Mark as read immediately — customer sees blue ticks showing agent engaged
  await markWhatsAppMessageRead(phoneNumberId, incomingMessageId, accessToken);

  // Typing delay: 50ms per char, clamped 800ms–3000ms
  const ms = Math.min(Math.max(responseText.length * 50, 800), 3000);
  await sendTypingIndicator(phoneNumberId, to, ms, accessToken);
}

/**
 * @returns o wamid (message id) atribuído pela Meta, ou undefined se não veio na resposta.
 * Esse id é o que a Meta usa depois para reportar status (delivered/read/failed) via
 * webhook — sem guardar ele, nunca dá pra casar essas atualizações assíncronas com a
 * mensagem certa no banco.
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string,
  contextMessageId?: string  // reply-to: quotes this message in WhatsApp
): Promise<string | undefined> {
  const token = resolveToken(accessToken);
  if (!token) {
    // Lançar aqui é essencial: os chamadores tratam falha de envio (retry,
    // status FAILED na mensagem, alerta ao dono) só a partir de uma exceção.
    // Um "return undefined" silencioso fazia a mensagem ficar marcada como
    // SENT no CRM mesmo sem nunca ter saído.
    throw new Error("[WhatsApp] No access token configured — cannot send message");
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

  const data = (await response.json()) as { messages?: Array<{ id?: string }> };
  return data.messages?.[0]?.id;
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
      to: normalizeBrazilianNumber(to),
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });

  if (!response.ok) throw new Error(`WhatsApp template send failed: ${await response.text()}`);
}

/** Send a WhatsApp location pin (shows interactive map to recipient) */
export async function sendWhatsAppLocation(
  phoneNumberId: string,
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;
  const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizeBrazilianNumber(to),
      type: "location",
      location: { latitude, longitude, name: name ?? "", address: address ?? "" },
    }),
  });
  if (!res.ok) console.error("[sendWhatsAppLocation]", await res.text());
}

/** Send a WhatsApp audio message via public URL */
export async function sendWhatsAppAudio(
  phoneNumberId: string,
  to: string,
  audioUrl: string,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;
  const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizeBrazilianNumber(to),
      type: "audio",
      audio: { link: audioUrl },
    }),
  });
  if (!res.ok) throw new Error(`[sendWhatsAppAudio] ${await res.text()}`);
}

/** Send typing indicator — marks message read then shows "digitando..." via Meta API */
export async function sendWhatsAppTyping(
  phoneNumberId: string,
  incomingMessageId: string,
  to: string,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) return;
  // Step 1: mark as read (blue ticks)
  await markWhatsAppMessageRead(phoneNumberId, incomingMessageId, accessToken);
  // Step 2: send typing indicator via Meta Cloud API (v21+)
  await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizeBrazilianNumber(to),
      type: "text",
      typing: true,
    }),
  }).catch(() => {});
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

export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  accessToken?: string,
): Promise<{ id: string } | null> {
  const token = resolveToken(accessToken);
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", mimeType);
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const res = await fetch(`${BASE_URL}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    console.error("[WhatsApp] Media upload failed:", res.status, await res.text());
    return null;
  }
  return res.json();
}

export async function sendWhatsAppAudioById(
  phoneNumberId: string,
  to: string,
  mediaId: string,
  accessToken?: string,
): Promise<void> {
  const token = resolveToken(accessToken);
  const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "audio",
      audio: { id: mediaId },
    }),
  });
  if (!res.ok) {
    console.error("[WhatsApp] Audio by ID send failed:", res.status, await res.text());
  }
}
