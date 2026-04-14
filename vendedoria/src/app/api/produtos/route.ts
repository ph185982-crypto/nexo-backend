import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ativo = searchParams.get("ativo");
  const q     = searchParams.get("q");
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50", 10));

  const where = {
    ...(ativo !== null ? { ativo: ativo !== "false" } : {}),
    ...(q ? { nome: { contains: q, mode: "insensitive" as const } } : {}),
    ehFerramenta: true,
  };

  const [total, produtos] = await Promise.all([
    prisma.produto.count({ where }),
    prisma.produto.findMany({
      where,
      orderBy: { importadoEm: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        nome: true,
        slug: true,
        precoCusto: true,
        precoVenda: true,
        precoDesconto: true,
        parcelamento: true,
        fotoUrl: true,
        descricao: true,
        categoria: true,
        ativo: true,
        importadoEm: true,
        ultimaOfertaEm: true,
        vezesUsadoEmOferta: true,
      },
    }),
  ]);

  return NextResponse.json({ total, page, limit, produtos });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ativo } = await req.json() as { id: string; ativo: boolean };
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

    const produto = await prisma.produto.update({
      where: { id },
      data: { ativo },
    });
    return NextResponse.json({ ok: true, produto });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  try {
    await prisma.produto.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
