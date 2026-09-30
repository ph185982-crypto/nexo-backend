// GET /api/financeiro/historico — livro-razão do financeiro (somente leitura).
//   ?entidade=Transacao|ReceitaPrevistaMax|...  &acao=criado|atualizado|excluido
//   &de=YYYY-MM-DD &ate=YYYY-MM-DD  &q=texto (descrição ou id)  &page= &pageSize=

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { MODELOS_FINANCEIROS_AUDITADOS } from "@/lib/finance/historico";
import { MODELOS_RESTAURAVEIS } from "@/lib/finance/restaurar";
import { parseData, somarDias } from "@/lib/finance/periodo";
import { carimbarHistoricoInicial } from "@/lib/finance/historico-inicial";

export const maxDuration = 30;

type Snap = Record<string, unknown> | null;

function resumir(antes: unknown, depois: unknown) {
  const s = ((depois ?? antes) as Snap) ?? {};
  const descricao =
    (s.descricao as string) ?? (s.nome as string) ?? (s.categoria as string) ?? (s.credor as string) ?? null;
  const valor = (s.valor as number) ?? (s.valor_alvo as number) ?? (s.valor_total as number) ?? (s.amount as number) ?? null;
  return { descricao, valor };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await carimbarHistoricoInicial().catch((e) => console.error("[financeiro] carimbo inicial do histórico falhou:", e));
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(sp.get("pageSize") ?? "30", 10) || 30));

    const and: Record<string, unknown>[] = [];
    const entidade = sp.get("entidade");
    if (entidade && (MODELOS_FINANCEIROS_AUDITADOS as readonly string[]).includes(entidade)) and.push({ entidade });
    const acao = sp.get("acao");
    if (acao === "criado" || acao === "atualizado" || acao === "excluido") and.push({ acao });

    const de = parseData(sp.get("de"));
    const ate = parseData(sp.get("ate"));
    if (de || ate) and.push({ criado_em: { ...(de ? { gte: de } : {}), ...(ate ? { lt: somarDias(ate, 1) } : {}) } });

    const q = sp.get("q")?.trim();
    if (q) {
      and.push({
        OR: [
          { entidade_id: q },
          { depois: { path: ["descricao"], string_contains: q } },
          { antes: { path: ["descricao"], string_contains: q } },
        ],
      });
    }

    const where = and.length ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      prisma.historicoFinanceiro.findMany({
        where,
        orderBy: { criado_em: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.historicoFinanceiro.count({ where }),
    ]);

    // Quais exclusões ainda podem ser restauradas (a linha não existe mais)?
    const excluidasRestauraveis = rows.filter((r) => r.acao === "excluido" && MODELOS_RESTAURAVEIS.includes(r.entidade as never));
    const aindaExistem = new Set<string>();
    for (const modelo of MODELOS_RESTAURAVEIS) {
      const ids = excluidasRestauraveis.filter((r) => r.entidade === modelo).map((r) => r.entidade_id);
      if (!ids.length) continue;
      const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<{ id: string }[]> }>)[
        modelo.charAt(0).toLowerCase() + modelo.slice(1)
      ];
      const existentes = await delegate.findMany({ where: { id: { in: ids } }, select: { id: true } });
      existentes.forEach((e) => aindaExistem.add(`${modelo}:${e.id}`));
    }

    const itens = rows.map((r) => ({
      id: r.id,
      entidade: r.entidade,
      entidade_id: r.entidade_id,
      acao: r.acao,
      criado_em: r.criado_em,
      antes: r.antes,
      depois: r.depois,
      ...resumir(r.antes, r.depois),
      restauravel:
        r.acao === "excluido" &&
        MODELOS_RESTAURAVEIS.includes(r.entidade as never) &&
        !aindaExistem.has(`${r.entidade}:${r.entidade_id}`),
    }));

    return NextResponse.json({
      itens,
      total,
      pagina: page,
      paginas: Math.max(1, Math.ceil(total / pageSize)),
      entidades: MODELOS_FINANCEIROS_AUDITADOS,
    });
  } catch (err) {
    console.error("[financeiro/historico GET]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
