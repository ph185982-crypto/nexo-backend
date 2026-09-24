import { NextRequest, NextResponse } from "next/server";
import { criarTemplateNaMeta, CATEGORIAS_META, type CategoriaMeta } from "@/lib/prospeccao/criar-template";

// POST /api/prospeccao/templates/criar-meta
// Cria um template de mensagem direto na Meta (Graph API) e já cadastra no
// banco como inativo/pendente. O template só fica disponível pro disparo
// depois de aprovado pela Meta (ver GET /api/prospeccao/disparo/template-meta/:orgId
// pra checar status, e PATCH /api/prospeccao/templates/:id { ativo: true } pra ativar).
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId?: string;
    nome?: string;
    categoria?: string;
    idioma?: string;
    corpoTexto?: string;
    variaveisOrdem?: string[];
    rodape?: string;
  };

  if (!body.organizationId || !body.nome || !body.corpoTexto) {
    return NextResponse.json(
      { error: "organizationId, nome e corpoTexto são obrigatórios" },
      { status: 400 },
    );
  }

  const categoria = (CATEGORIAS_META as readonly string[]).includes(body.categoria ?? "")
    ? (body.categoria as CategoriaMeta)
    : "MARKETING";

  const resultado = await criarTemplateNaMeta({
    organizationId: body.organizationId,
    nome: body.nome,
    categoria,
    idioma: body.idioma,
    corpoTexto: body.corpoTexto,
    variaveisOrdem: body.variaveisOrdem ?? [],
    rodape: body.rodape,
  });

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: resultado.status });
  }
  return NextResponse.json(resultado, { status: 201 });
}
