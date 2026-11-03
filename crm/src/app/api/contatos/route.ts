import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { CICLOS, criarContato, ErroDuplicado, TIPOS_CONTATO } from "@/lib/contatos/servico";
import { comEntrada, escolha, texto, textoOpc } from "@/lib/validar";

export const dynamic = "force-dynamic";
const POR_PAGINA = 25;

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const u = new URL(req.url).searchParams;
  const q = u.get("q")?.trim();
  const pagina = Math.max(1, Number(u.get("pagina")) || 1);
  const tipo = u.get("tipo");
  const ciclo = u.get("ciclo");
  const where = {
    ...(tipo === "EMPRESA" || tipo === "PESSOA" ? { tipo } : {}),
    ...(ciclo && (CICLOS as readonly string[]).includes(ciclo) ? { cicloDeVida: ciclo } : {}),
    ...(q ? { OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { telefone: { contains: q.replace(/\D/g, "") || "§" } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, itens] = await Promise.all([
    prisma.contato.count({ where }),
    prisma.contato.findMany({
      where, orderBy: { criadoEm: "desc" }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA,
      select: { id: true, tipo: true, nome: true, telefone: true, email: true, segmento: true, cicloDeVida: true, empresa: { select: { nome: true } }, _count: { select: { oportunidades: true } } },
    }),
  ]);
  return Response.json({ total, pagina, porPagina: POR_PAGINA, itens });
}

export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  try {
    return await comEntrada(async () => {
      const novo = await criarContato({
        tipo: escolha(c.tipo, "tipo", TIPOS_CONTATO, "PESSOA"), nome: texto(c.nome, "Nome", { min: 1, max: 200 }), telefone: textoOpc(c.telefone, "Telefone", 40), email: textoOpc(c.email, "E-mail", 200),
        documento: textoOpc(c.documento, "Documento", 30), segmento: textoOpc(c.segmento, "Segmento", 100), cargo: textoOpc(c.cargo, "Cargo", 100), origem: textoOpc(c.origem, "Origem", 100) ?? "Manual",
        cicloDeVida: escolha(c.cicloDeVida, "ciclo de vida", CICLOS, "LEAD"), empresaId: textoOpc(c.empresaId, "empresaId", 60), responsavelId: uid,
      });
      return Response.json({ id: novo.id }, { status: 201 });
    });
  } catch (e) {
    if (e instanceof ErroDuplicado) return Response.json({ erro: e.message, existenteId: e.existenteId }, { status: 409 });
    throw e;
  }
}
