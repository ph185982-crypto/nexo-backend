/**
 * TEMPORARY — calls Meta Graph API to subscribe WABA to app webhooks + test send
 */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const url = new URL(req.url);
  const testTo = url.searchParams.get("sendTo");
  const testWaba = url.searchParams.get("waba");
  const testPhone = url.searchParams.get("phone");

  if (!token) {
    return NextResponse.json({ error: "Missing META_WHATSAPP_ACCESS_TOKEN" }, { status: 400 });
  }

  const results: Record<string, unknown> = {
    config: {
      wabaId,
      phoneNumberId,
      tokenPrefix: token.slice(0, 15) + "...",
    }
  };

  // 1. Token info (who am I?)
  const tokenRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,accounts&access_token=${token}`);
  results.tokenInfo = await tokenRes.json();

  // 2. Token permissions
  const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`);
  results.tokenPermissions = await permRes.json();

  // 3. Try the "IA VENDE" entity ID as WABA
  const entityId = (results.tokenInfo as {id?: string})?.id;
  if (entityId) {
    const entityPhoneRes = await fetch(`https://graph.facebook.com/v21.0/${entityId}/phone_numbers?access_token=${token}`);
    results.entityPhoneNumbers = await entityPhoneRes.json();

    const entitySubscribeRes = await fetch(`https://graph.facebook.com/v21.0/${entityId}/subscribed_apps?access_token=${token}`);
    results.entitySubscribed = await entitySubscribeRes.json();
  }

  // 4. Test with optional waba/phone params
  if (testWaba) {
    const testSubRes = await fetch(`https://graph.facebook.com/v21.0/${testWaba}/subscribed_apps?access_token=${token}`);
    results.testWabaSubscribed = await testSubRes.json();
    const testPhoneListRes = await fetch(`https://graph.facebook.com/v21.0/${testWaba}/phone_numbers?access_token=${token}`);
    results.testWabaPhones = await testPhoneListRes.json();
  }

  // 5. Current env WABA check
  if (wabaId) {
    const checkRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps?access_token=${token}`);
    results.wabaSubscriptions = await checkRes.json();

    const wabaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}?fields=id,name,phone_numbers&access_token=${token}`);
    results.wabaInfo = await wabaInfoRes.json();
  }

  // 6. Phone number
  if (phoneNumberId) {
    const phoneRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,status&access_token=${token}`);
    results.phoneNumber = await phoneRes.json();
  }

  // 7. Test send
  const targetPhone = testTo;
  const targetPhoneId = testPhone ?? phoneNumberId;
  if (targetPhone && targetPhoneId) {
    const sendRes = await fetch(`https://graph.facebook.com/v21.0/${targetPhoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: targetPhone,
        type: "text",
        text: { body: "✅ Teste direto da API — Léo, Nexo Brasil. Se você recebeu isso, o envio está funcionando!" },
      }),
    });
    results.testSend = await sendRes.json();
  }

  return NextResponse.json(results, { status: 200 });
}
