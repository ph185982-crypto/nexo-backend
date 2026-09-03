import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

export async function GET() {
  try {
    await requireAdmin();

    const dividas = await prisma.dividaMax.findMany({
      orderBy: { criado_em: "desc" },
    });

    const result = dividas.map((d) => ({
      ...d,
      restante: d.valor_total - d.valor_pago,
      progresso:
        d.valor_total > 0
          ? Math.round((d.valor_pago / d.valor_total) * 10000) / 100
          : 0,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/dividas GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
