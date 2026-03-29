const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function resolveToken(override?: string): string | undefined {
  return override ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) {
    console.warn("[WhatsApp] No access token configured — skipping send");
    return;
  }

  const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
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
  accessToken?: string
): Promise<void> {
  const token = resolveToken(accessToken);
  if (!token) {
    console.warn("[WhatsApp] No access token — skipping image send");
    return;
  }

  const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[WhatsApp] Image send error:", error);
    throw new Error(`WhatsApp image send failed: ${error}`);
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
  if (!token) {
    console.warn("[WhatsApp] No access token — skipping template send");
    return;
  }

  const response = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[WhatsApp] Template send error:", error);
    throw new Error(`WhatsApp template send failed: ${error}`);
  }
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
    {
      headers: { "Authorization": `Bearer ${token}` },
    }
  );

  if (!response.ok) throw new Error("Failed to get phone info");
  return response.json();
}
