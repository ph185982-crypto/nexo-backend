/**
 * TEMPORARY — REMOVE AFTER USE
 * GET /api/debug/probe
 * Queries Meta API with stored token to return real phone number info.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  try {
    const config = await prisma.whatsappProviderConfig.findFirst({
      select: { businessPhoneNumberId: true, accessToken: true },
    });

    if (!config) return NextResponse.json({ error: "No providerConfig found" }, { status: 404 });

    const token = config.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
    if (!token) return NextResponse.json({ error: "No access token" }, { status: 500 });

    const res = await fetch(
      `https://graph.facebook.com/v20.0/${config.businessPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await res.json();
    return NextResponse.json({ phoneNumberId: config.businessPhoneNumberId, meta: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
