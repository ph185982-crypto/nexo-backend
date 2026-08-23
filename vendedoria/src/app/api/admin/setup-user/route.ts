/**
 * GET /api/admin/setup-user
 * - Se não existir nenhum usuário no banco: cria o admin automaticamente (primeiro acesso).
 * - Se já existir usuário: exige ?secret=<CRON_SECRET> para atualizar.
 * Idempotente e seguro para produção.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  const userCount = await prisma.user.count();

  // Primeiro acesso: banco vazio, cria sem secret
  if (userCount === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const user = await prisma.user.create({
      data: {
        name: "Administrador",
        email: "admin@vendedoria.com",
        password: hashedPassword,
        role: "ADMIN",
      },
    });

    return NextResponse.json({
      ok: true,
      userId: user.id,
      email: user.email,
      password: "admin123",
      message: "Primeiro acesso: usuário admin criado. Troque a senha após o login.",
    });
  }

  // Banco já tem usuários: exige secret para atualizar
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Usuário já existe. Forneça ?secret=<CRON_SECRET> para atualizar." },
      { status: 401 },
    );
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
    message: `Usuário ${email} atualizado com sucesso`,
  });
}
