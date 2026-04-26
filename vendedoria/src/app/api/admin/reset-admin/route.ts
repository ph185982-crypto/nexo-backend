import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma/client";

// One-time admin reset — protected by CRON_SECRET or NEXTAUTH_SECRET
// GET /api/admin/reset-admin?secret=<NEXTAUTH_SECRET>
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  const validSecret = process.env.NEXTAUTH_SECRET ?? process.env.CRON_SECRET;
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email    = searchParams.get("email")    ?? "admin@vendedoria.com";
  const password = searchParams.get("password") ?? "admin123";

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where:  { email },
    update: { password: hashed, name: "Administrador", role: "ADMIN" },
    create: { email, password: hashed, name: "Administrador", role: "ADMIN" },
  });

  return NextResponse.json({
    ok:    true,
    email: user.email,
    msg:   `Usuário ${user.email} criado/atualizado com a senha informada.`,
  });
}
