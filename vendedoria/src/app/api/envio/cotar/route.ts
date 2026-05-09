import { NextRequest, NextResponse } from 'next/server';
import { cotarFrete } from '@/lib/envio/melhor-envio';

// GET /api/envio/cotar?cep=01310100
export async function GET(req: NextRequest) {
  const cep = req.nextUrl.searchParams.get('cep') ?? '';
  const cepLimpo = cep.replace(/\D/g, '');

  if (cepLimpo.length !== 8) {
    return NextResponse.json(
      { error: 'CEP inválido — informe 8 dígitos', opcoes: [] },
      { status: 400 },
    );
  }

  try {
    const opcoes = await cotarFrete(cepLimpo);
    return NextResponse.json({ opcoes });
  } catch (err: unknown) {
    console.error('[API cotar frete]', err);
    return NextResponse.json({ error: 'Erro ao cotar frete', opcoes: [] }, { status: 200 });
  }
}
