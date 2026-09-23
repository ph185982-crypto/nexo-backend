import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "OPENAI" },
    select: { refreshToken: true },
  }).catch(() => null);
  const key = cred?.refreshToken ?? process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 400 });

  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const data = await res.json();
  const ids = (data.data as Array<{ id: string }>).map((m) => m.id).sort();
  return NextResponse.json({ count: ids.length, ids });
}
