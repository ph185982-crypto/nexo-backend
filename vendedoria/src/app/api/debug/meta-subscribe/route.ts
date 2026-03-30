/**
 * TEMPORARY — calls Meta Graph API to subscribe WABA to app webhooks + test send
 * GET /api/debug/meta-subscribe           → verify token + subscribe WABA
 * GET /api/debug/meta-subscribe?sendTo=5562984465388 → also sends a test message
 */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const url = new URL(req.url);
  const testTo = url.searchParams.get("sendTo");

  if (!token || !wabaId) {
    return NextResponse.json({ error: "Missing META_WHATSAPP_ACCESS_TOKEN or META_WHATSAPP_WABA_ID" }, { status: 400 });
  }

  const results: Record<string, unknown> = {};

  // 1. Token info
  const tokenRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
  results.tokenInfo = await tokenRes.json();

  // 2. Current subscriptions
  const checkRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps?access_token=${token}`);
  results.currentSubscriptions = await checkRes.json();

  // 3. Subscribe WABA to app
  const subRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  results.subscribe = await subRes.json();

  // 4. Phone number status
  if (phoneNumberId) {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating&access_token=${token}`
    );
    results.phoneNumber = await phoneRes.json();
  }

  // 5. Test send (pass ?sendTo=PHONE_NUMBER to trigger)
  if (testTo && phoneNumberId) {
    const sendRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: testTo,
        type: "text",
        text: { body: "✅ Teste direto da API — Léo, Nexo Brasil. Se você recebeu isso, o envio está funcionando!" },
      }),
    });
    results.testSend = await sendRes.json();
  }

  return NextResponse.json(results, { status: 200 });
}
