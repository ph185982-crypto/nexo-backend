/**
 * TEMPORARY — calls Meta Graph API to subscribe WABA to app webhooks
 * Hit GET /api/debug/meta-subscribe to trigger, DELETE to remove
 */
import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !wabaId) {
    return NextResponse.json({ error: "Missing META_WHATSAPP_ACCESS_TOKEN or META_WHATSAPP_WABA_ID" }, { status: 400 });
  }

  const results: Record<string, unknown> = {};

  // 1. Check current subscribed apps on WABA
  const checkRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps?access_token=${token}`
  );
  results.currentSubscriptions = await checkRes.json();

  // 2. Subscribe WABA to app (POST)
  const subRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token }),
    }
  );
  results.subscribe = await subRes.json();

  // 3. Check phone number registration
  if (phoneNumberId) {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating&access_token=${token}`
    );
    results.phoneNumber = await phoneRes.json();
  }

  // 4. Check token validity
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/me?access_token=${token}`
  );
  results.tokenInfo = await tokenRes.json();

  return NextResponse.json(results, { status: 200 });
}
