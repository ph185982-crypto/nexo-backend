// POST /api/max/clean-history — limpa conversas antigas com conteúdo grande (base64 de imagens)
// Requer Bearer CRON_SECRET (deleta dados).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { MAX_OWNER_NUMBER } from "@/lib/max/config";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Conta total antes
  const totalBefore = await prisma.conversaMax.count({ where: { numero: MAX_OWNER_NUMBER } });

  // Deleta conversas com conteúdo maior que 3000 chars (base64 de imagens)
  const deleted = await prisma.conversaMax.deleteMany({
    where: {
      numero: MAX_OWNER_NUMBER,
      content: { contains: "data:image" },
    },
  });

  // Mantém só as últimas 50 conversas limpas
  const recent = await prisma.conversaMax.findMany({
    where: { numero: MAX_OWNER_NUMBER },
    orderBy: { criado_em: "desc" },
    take: 50,
    select: { id: true },
  });
  const keepIds = recent.map((r) => r.id);

  const deletedOld = await prisma.conversaMax.deleteMany({
    where: {
      numero: MAX_OWNER_NUMBER,
      id: { notIn: keepIds },
    },
  });

  const totalAfter = await prisma.conversaMax.count({ where: { numero: MAX_OWNER_NUMBER } });

  return NextResponse.json({
    ok: true,
    totalBefore,
    deletedBase64: deleted.count,
    deletedOld: deletedOld.count,
    totalAfter,
  });
}
