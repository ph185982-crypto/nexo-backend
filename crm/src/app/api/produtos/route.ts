// Catálogo de produtos: qualquer usuário lê (para escolher na oportunidade); só administrador cadastra.
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { exigirAdmin } from "@/lib/auth/admin";
import { comEntrada } from "@/lib/validar";
import { listarProdutos, validarProduto, type DadosProduto } from "@/lib/oportunidades/produtos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const todos = new URL(req.url).searchParams.get("todos") === "1";
  const produtos = await listarProdutos(todos);
  return Response.json({ produtos: produtos.map((p) => ({ ...p, valor: Number(p.valor) })) });
}

export async function POST(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const d = validarProduto(c) as DadosProduto;
    if (await prisma.produto.findUnique({ where: { nome: d.nome } })) return Response.json({ erro: "Já existe produto com esse nome" }, { status: 409 });
    const p = await prisma.produto.create({ data: d });
    return Response.json({ id: p.id }, { status: 201 });
  });
}
