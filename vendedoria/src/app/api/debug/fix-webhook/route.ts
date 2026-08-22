import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;
  const callbackUri = "https://nexo-vendedoria.vercel.app/api/webhooks/whatsapp";

  if (!token || !wabaId || !verifyToken) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 400 });
  }

  const phonesRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${token}`,
  );
  const phonesData = await phonesRes.json() as { data?: Array<{ id: string; display_phone_number: string }>; error?: unknown };

  if (!phonesData.data) {
    return NextResponse.json({ error: "Failed to list phones", detail: phonesData }, { status: 500 });
  }

  const results: Record<string, unknown> = {};

  for (const phone of phonesData.data) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phone.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: token,
        webhook_configuration: {
          override_callback_uri: callbackUri,
          verify_token: verifyToken,
        },
      }),
    });
    results[phone.display_phone_number] = { id: phone.id, status: res.status, body: await res.json() };
  }

  return NextResponse.json({ callbackUri, results });
}
