// /api/integracoes/avanteza/financeiro/<recurso>?escopo=empresa|pessoal — API de serviço do financeiro (Central Avanteza).
// Autenticação própria (Bearer AVANTEZA_FINANCE_KEY; 503 sem a variável, 401 com chave errada); sem logs de valores.
// Recursos, formatos e exemplos: docs/integracao-avanteza.md. Lógica em src/lib/integracoes/avanteza-financeiro.ts.
import { NextRequest } from "next/server";
import { tratarFinanceiro } from "@/lib/integracoes/avanteza-financeiro";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ path: string[] }> };
const tratar = async (req: NextRequest, { params }: Ctx) => tratarFinanceiro(req, (await params).path ?? []);

export const GET = tratar;
export const POST = tratar;
export const PATCH = tratar;
export const DELETE = tratar;
