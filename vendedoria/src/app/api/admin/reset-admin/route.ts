import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma/client";

// Setup endpoint — creates/resets admin user
// Accepts: NEXTAUTH_SECRET, CRON_SECRET, or the built-in setup token
const SETUP_TOKEN = "nexo-setup-2025";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret") ?? "";

  const validSecrets = [
    SETUP_TOKEN,
    process.env.NEXTAUTH_SECRET,
    process.env.CRON_SECRET,
  ].filter(Boolean);

  if (!validSecrets.includes(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email    = searchParams.get("email")    ?? "admin@vendedoria.com";
  const password = searchParams.get("password") ?? "admin123";
  const name     = searchParams.get("name")     ?? "Administrador";

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where:  { email },
    update: { password: hashed, name, role: "ADMIN" },
    create: { email, password: hashed, name, role: "ADMIN" },
  });

  return NextResponse.json({
    ok:    true,
    email: user.email,
    msg:   `Usuário criado/atualizado com sucesso. Faça login em /login`,
  });
}
