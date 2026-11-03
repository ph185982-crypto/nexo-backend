import { auditoria, funilPorEtapa, ganhosEPerdas, kpis, ranking } from "@/lib/relatorios/consultas";
import { lerPeriodo } from "@/lib/relatorios/periodo";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha } from "@/lib/validar";

export const dynamic = "force-dynamic";
const TIPOS = ["kpis", "funil", "ganhos-perdas", "ranking", "auditoria"] as const;

export async function GET(req: Request, ctx: { params: Promise<{ tipo: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return comEntrada(async () => {
    const tipo = escolha((await ctx.params).tipo, "relatório", TIPOS);
    const u = new URL(req.url).searchParams;
    const p = lerPeriodo(u.get("de"), u.get("ate"));
    const funilId = u.get("funilId") || null;
    const periodo = { de: p.de.toISOString(), ate: p.ate.toISOString() };
    switch (tipo) {
      case "kpis": return Response.json({ periodo, ...(await kpis(p, funilId)) });
      case "funil": {
        if (!funilId) return Response.json({ erro: "funilId obrigatório" }, { status: 400 });
        const r = await funilPorEtapa(p, funilId);
        return r ? Response.json({ periodo, ...r }) : Response.json({ erro: "Funil não encontrado" }, { status: 404 });
      }
      case "ganhos-perdas": return Response.json({ periodo, ...(await ganhosEPerdas(p, funilId)) });
      case "ranking": return Response.json({ periodo, linhas: await ranking(p, funilId) });
      case "auditoria": return Response.json({ periodo, linhas: await auditoria(p, { funilId, origem: u.get("origem") }) });
    }
  });
}
