import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "30", 10)));
    const tipo = url.searchParams.get("tipo");
    const categoria = url.searchParams.get("categoria");
    const tipo_negocio = url.searchParams.get("tipo_negocio");
    const texto = url.searchParams.get("texto");
    const data_inicio = url.searchParams.get("data_inicio");
    const data_fim = url.searchParams.get("data_fim");

    const where: Record<string, unknown> = {};
    if (tipo) where.tipo = tipo;
    if (categoria) where.categoria = categoria;
    if (tipo_negocio) where.tipo_negocio = tipo_negocio;
    if (texto) where.descricao = { contains: texto, mode: "insensitive" };
    if (data_inicio || data_fim) {
      where.data_transacao = {};
      if (data_inicio) (where.data_transacao as Record<string, unknown>).gte = new Date(data_inicio);
      if (data_fim) (where.data_transacao as Record<string, unknown>).lte = new Date(data_fim);
    }

    const [transacoes, total] = await Promise.all([
      prisma.transacao.findMany({
        where,
        orderBy: [{ data_transacao: "desc" }, { criado_em: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transacao.count({ where }),
    ]);

    return NextResponse.json({ transacoes, total, page, pageSize });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/transacoes GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { tipo, valor, descricao, categoria, tipo_negocio, data_transacao, empresa } = body;

    if (!tipo || valor == null || !descricao || !categoria) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const dataTransacao = data_transacao ? new Date(data_transacao) : new Date();
    const mes = `${dataTransacao.getFullYear()}-${String(dataTransacao.getMonth() + 1).padStart(2, "0")}`;

    const transacao = await prisma.transacao.create({
      data: {
        tipo,
        valor: Math.round(valor * 100) / 100,
        descricao,
        categoria,
        tipo_negocio: tipo_negocio ?? "pessoal",
        data_transacao: dataTransacao,
        mes,
        empresa: empresa ?? null,
      },
    });

    return NextResponse.json(transacao, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[financeiro/transacoes POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
