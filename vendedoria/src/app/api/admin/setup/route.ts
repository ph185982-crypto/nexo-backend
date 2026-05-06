import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import bcrypt from "bcryptjs";

// Cria ou reseta o usuário admin.
// - Sem secret: funciona apenas se não existir NENHUM usuário no banco (first-run)
// - Com secret: GET /api/admin/setup?secret=<CRON_SECRET>
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");

  const userCount = await prisma.user.count();
  const secretOk = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  const firstRun = userCount === 0;

  if (!secretOk && !firstRun) {
    return NextResponse.json(
      { error: "Unauthorized. Passe ?secret=<CRON_SECRET> ou acesse com banco vazio." },
      { status: 401 }
    );
  }

  const email = "admin@nexovendas.com";
  const password = "Nexo@2025";
  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { password: hashed, name: "Administrador" },
    create: { name: "Administrador", email, password: hashed, role: "ADMIN" },
  });

  await prisma.user.upsert({
    where: { email: "admin@vendedoria.com" },
    update: { password: hashed },
    create: { name: "Administrador", email: "admin@vendedoria.com", password: hashed, role: "ADMIN" },
  });

  return NextResponse.json({
    ok: true,
    email,
    password,
    message: "Admin criado/resetado. Acesse /login com as credenciais acima.",
  });
}
