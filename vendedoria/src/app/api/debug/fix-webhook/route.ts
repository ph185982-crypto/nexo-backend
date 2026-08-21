/**
 * TEMPORARY — REMOVE AFTER USE
 * Corrige o override_callback_uri de cada número WhatsApp da WABA para
 * apontar para o webhook da Vercel, em vez da VPS antiga (Hostinger).
 */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;

  if (!token || !wabaId || !verifyToken) {
    return NextResponse.json(
      { error: "Faltando META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_WABA_ID ou META_WHATSAPP_VERIFY_TOKEN" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const callbackUri =
    url.searchParams.get("callback") ??
    "https://nexo-vendedoria.vercel.app/api/webhooks/whatsapp";

  // 1. Lista números da WABA
  const phonesRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${token}`,
  );
  const phonesData = (await phonesRes.json()) as {
    data?: Array<{ id: string; display_phone_number: string }>;
    error?: unknown;
  };

  if (!phonesData.data) {
    return NextResponse.json({ error: "Falha ao listar números", detail: phonesData }, { status: 500 });
  }

  const results: Record<string, unknown> = {};

  for (const phone of phonesData.data) {
    const updateRes = await fetch(`https://graph.facebook.com/v21.0/${phone.id}`, {
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
    const updateData = await updateRes.json();
    results[phone.display_phone_number] = { phoneId: phone.id, status: updateRes.status, response: updateData };
  }

  return NextResponse.json({ callbackUri, results }, { status: 200 });
}
