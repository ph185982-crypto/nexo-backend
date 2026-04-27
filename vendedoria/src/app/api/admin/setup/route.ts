import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import bcrypt from "bcryptjs";

// Cria ou reseta o usuário admin.
// Uso: GET /api/admin/setup?secret=<CRON_SECRET>
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = "admin@nexovendas.com";
  const password = "Nexo@2025";
  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hashed, name: "Administrador" },
    create: {
      name: "Administrador",
      email,
      password: hashed,
      role: "ADMIN",
    },
  });

  // Também garante que o e-mail antigo (seed padrão) funciona
  await prisma.user.upsert({
    where: { email: "admin@vendedoria.com" },
    update: { password: hashed },
    create: {
      name: "Administrador",
      email: "admin@vendedoria.com",
      password: hashed,
      role: "ADMIN",
    },
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    password,
    message: "Usuário admin criado/resetado com sucesso.",
  });
}
