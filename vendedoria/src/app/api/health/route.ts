import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  let dbStatus = "connected";
  let dbError = "";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "error";
    dbError = String(err).slice(0, 200);
  }

  const authOk = !!(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET);
  const ok = dbStatus === "connected" && authOk;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db: dbStatus,
      ...(dbError ? { dbError } : {}),
      auth: authOk ? "configured" : "MISSING — NEXTAUTH_SECRET/AUTH_SECRET nao definido",
      env: process.env.NODE_ENV,
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
