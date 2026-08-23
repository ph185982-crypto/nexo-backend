/**
 * GET /api/admin/setup-user?secret=<CRON_SECRET>&email=<email>&password=<senha>
 * Cria ou atualiza o usuário admin no banco de produção.
 * Protegido por CRON_SECRET — seguro chamar várias vezes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = req.nextUrl.searchParams.get("email") ?? "admin@vendedoria.com";
  const password = req.nextUrl.searchParams.get("password") ?? "admin123";

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hashedPassword, role: "ADMIN" },
    create: {
      name: "Administrador",
      email,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  return NextResponse.json({
    ok: true,
    userId: user.id,
    email: user.email,
    message: `Usuário ${email} criado/atualizado com sucesso`,
  });
}
