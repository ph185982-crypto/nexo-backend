// GET  /api/financeiro/receitas  — lista com filtros (mes, dia, de/ate, status, escopo, contrato_id)
// POST /api/financeiro/receitas  — cria receita avulsa, parcelada ou recorrente (contrato).
//   modo "avulsa"     → { descricao, valor, data_prevista, cliente?, tipo_negocio?, observacao? }
//   modo "parcelada"  → { ..., valor_total | valor_parcela, meses, data_prevista }  (divide e gera as parcelas)
//   modo "recorrente" → { ..., valor_parcela, meses | null (indeterminado), data_prevista }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getBrasiliaDateOnly } from "@/lib/max/config";
import { criarContrato, garantirParcelasContratos } from "@/lib/finance/contratos";
import { parseEscopo, whereEscopoReceita } from "@/lib/finance/escopo";
import { isMesValido, parseData, primeiroDiaDoMes, ultimoDiaDoMes } from "@/lib/finance/periodo";
import { gerarParcelas } from "@/lib/finance/parcelas";
import { ErroValidacao } from "@/lib/finance/erros";

function proibido() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return proibido();
  }

  try {
    await garantirParcelasContratos();

    const sp = req.nextUrl.searchParams;
    const hoje = getBrasiliaDateOnly();
    const and: Record<string, unknown>[] = [];

    // Período (sem nenhum parâmetro → todo o histórico)
    const dia = parseData(sp.get("dia"));
    const de = parseData(sp.get("de"));
    const ate = parseData(sp.get("ate"));
    const mes = sp.get("mes");
    if (dia) and.push({ data_prevista: dia });
    else if (de || ate) and.push({ data_prevista: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } });
    else if (isMesValido(mes)) and.push({ data_prevista: { gte: primeiroDiaDoMes(mes), lte: ultimoDiaDoMes(mes) } });

    const escopo = parseEscopo(sp.get("escopo"));
    if (escopo !== "todos") and.push(whereEscopoReceita(escopo));

    const contratoId = sp.get("contrato_id");
    if (contratoId) and.push({ contrato_id: contratoId });

    // "atrasada" é derivada: pendente com data anterior a hoje (o status gravado pode ser "pendente" ou "atrasada")
    const status = sp.get("status");
    if (status === "abertas") and.push({ status: { in: ["pendente", "atrasada"] } });
    else if (status === "atrasada") {
      and.push({ OR: [{ status: "atrasada" }, { status: "pendente", data_prevista: { lt: hoje } }] });
    } else if (status === "pendente") and.push({ status: "pendente", data_prevista: { gte: hoje } });
    else if (status === "recebida" || status === "perdida") and.push({ status });

    const receitas = await prisma.receitaPrevistaMax.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ data_prevista: "asc" }, { criado_em: "asc" }],
      take: 1000,
    });

    const itens = receitas.map((r) => ({
      ...r,
      atrasada: r.status === "atrasada" || (r.status === "pendente" && r.data_prevista < hoje),
    }));

    const soma = (fn: (r: (typeof itens)[number]) => boolean) => {
      const sel = itens.filter(fn);
      return { quantidade: sel.length, total: Math.round(sel.reduce((s, r) => s + r.valor, 0) * 100) / 100 };
    };
    const totais = {
      abertas: soma((r) => r.status === "pendente" || r.status === "atrasada"),
      atrasadas: soma((r) => r.atrasada),
      recebidas: soma((r) => r.status === "recebida"),
      perdidas: soma((r) => r.status === "perdida"),
    };

    return NextResponse.json({ receitas: itens, totais });
  } catch (err) {
    console.error("[financeiro/receitas GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return proibido();
  }

  try {
    const body = await req.json();
    const modo: "avulsa" | "parcelada" | "recorrente" =
      body.modo === "parcelada" || body.modo === "recorrente" ? body.modo : "avulsa";
    const { descricao, data_prevista, tipo_negocio, cliente, observacao } = body;

    if (!descricao?.toString().trim() || !data_prevista) {
      return NextResponse.json({ error: "Informe descrição e data." }, { status: 400 });
    }
    if (!parseData(data_prevista)) {
      return NextResponse.json({ error: "Data inválida (use AAAA-MM-DD)." }, { status: 400 });
    }

    if (modo === "avulsa") {
      const valor = Number(body.valor);
      if (!(valor > 0)) return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
      const receita = await prisma.receitaPrevistaMax.create({
        data: {
          descricao: descricao.toString().trim(),
          valor: Math.round(valor * 100) / 100,
          data_prevista: parseData(data_prevista)!,
          tipo_negocio: tipo_negocio ?? null,
          cliente: cliente ?? null,
          observacao: observacao ?? null,
        },
      });
      return NextResponse.json(receita, { status: 201 });
    }

    // Parcelada / recorrente → contrato + parcelas geradas automaticamente
    const indeterminado = modo === "recorrente" && (body.meses === null || body.meses === "" || body.meses === undefined);
    const meses = indeterminado ? null : Number(body.meses);
    const valorParcela = body.valor_parcela != null && body.valor_parcela !== "" ? Number(body.valor_parcela) : undefined;
    const valorTotal = body.valor_total != null && body.valor_total !== "" ? Number(body.valor_total) : undefined;

    // Parcelada aceita total OU parcela (o outro é calculado); valida antes de gravar.
    const totalEfetivo = modo === "parcelada" ? valorTotal ?? (valorParcela && meses ? valorParcela * meses : undefined) : undefined;
    gerarParcelas({
      primeiroVencimento: data_prevista,
      meses: meses ?? 12,
      diaVencimento: body.dia_vencimento ? Number(body.dia_vencimento) : undefined,
      ...(modo === "parcelada" ? { valorTotal: totalEfetivo } : { valorParcela }),
    });

    const resultado = await criarContrato({
      descricao: descricao.toString(),
      cliente,
      tipo_negocio,
      modo,
      valor_parcela: valorParcela,
      valor_total: totalEfetivo,
      meses,
      primeiro_vencimento: data_prevista,
      dia_vencimento: body.dia_vencimento ? Number(body.dia_vencimento) : undefined,
      observacao,
    });

    return NextResponse.json(resultado, { status: 201 });
  } catch (err) {
    if (err instanceof ErroValidacao) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[financeiro/receitas POST]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
