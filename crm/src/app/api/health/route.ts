import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "connected" });
  } catch {
    return Response.json({ status: "erro", db: "disconnected" }, { status: 503 });
  }
}
