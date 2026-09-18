import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { detectarTipoTelefoneBR } from "@/lib/prospeccao/sourcing";

/**
 * TEMPORARY — importa em lote as lojas do diretório oficial do Mega Polo
 * Moda (Rua 44, Goiânia), raspado do endpoint público lojasAjax.php do
 * próprio site (dados públicos, telefone/WhatsApp já fornecido por cada
 * lojista pro diretório). Todas viram ProspectLead com status NOVO — passam
 * pelo mesmo funil de enriquecimento/análise/aprovação dos leads sourceados
 * normalmente. DELETE após rodar.
 */
function normalizarTelefoneBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const comDDI = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return `+${comDDI}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
    segmentId?: string;
    lojas?: Array<{ nome: string | null; telefone: string | null; unidade: string | null }>;
  } | null;

  if (!body?.organizationId || !body?.segmentId || !Array.isArray(body.lojas)) {
    return NextResponse.json({ error: "organizationId, segmentId e lojas[] são obrigatórios" }, { status: 400 });
  }

  let inseridos = 0;
  let ignorados = 0;
  const detalhes: string[] = [];

  for (const loja of body.lojas) {
    if (!loja.nome || !loja.telefone) { ignorados++; continue; }
    const telefone = normalizarTelefoneBR(loja.telefone);
    if (!telefone) { ignorados++; continue; }

    const placeId = `mpm:${loja.unidade ?? loja.nome}`.toLowerCase().replace(/\s+/g, "-");
    const existing = await prisma.prospectLead.findUnique({ where: { placeId } });
    if (existing) { ignorados++; continue; }

    await prisma.prospectLead.create({
      data: {
        organizationId: body.organizationId,
        segmentId: body.segmentId,
        placeId,
        nome: loja.nome,
        telefone,
        tipoTelefone: detectarTipoTelefoneBR(telefone) ?? "CELULAR",
        enderecoCompleto: `Mega Polo Moda, Loja ${loja.unidade ?? "?"}, Rua 44, Setor Norte Ferroviário, Goiânia, GO`,
      },
    });
    inseridos++;
    detalhes.push(loja.nome);
  }

  return NextResponse.json({ ok: true, inseridos, ignorados, detalhes });
}
