import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detalheEntrega } from "@/lib/entrega/servico";
import { PILARES, STATUS_ENTREGA } from "@/lib/entrega/constantes";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, dataOpc, escolha, texto } from "@/lib/validar";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const e = await detalheEntrega((await ctx.params).id);
  return e ? Response.json(e) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const atual = await prisma.entrega.findUnique({ where: { id }, select: { diagnostico: true } });
    if (!atual) return Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
    let diagnostico: Prisma.InputJsonValue | undefined;
    if (c.diagnostico !== undefined) {
      const d = (typeof c.diagnostico === "object" && c.diagnostico !== null ? c.diagnostico : {}) as Record<string, unknown>;
      const merged = { ...(atual.diagnostico as Record<string, string>) };
      for (const [k, v] of Object.entries(d)) {
        if (!(PILARES as readonly string[]).includes(k)) continue;
        merged[k] = texto(v ?? "", `Diagnóstico ${k}`, { max: 5000 });
      }
      diagnostico = merged;
    }
    await prisma.entrega.update({
      where: { id },
      data: {
        ...(c.status !== undefined && { status: escolha(c.status, "status", STATUS_ENTREGA) }),
        ...(c.renovacaoEm !== undefined && { renovacaoEm: dataOpc(c.renovacaoEm, "Renovação") }),
        ...(c.fimPrevistoEm !== undefined && { fimPrevistoEm: dataOpc(c.fimPrevistoEm, "Fim previsto") }),
        ...(diagnostico !== undefined && { diagnostico }),
      },
    });
    return Response.json({ ok: true });
  });
}
