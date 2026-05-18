import { NextRequest, NextResponse } from 'next/server';

// GET /api/cep/:cep — consulta ViaCEP e retorna logradouro, bairro, cidade, estado
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cep: string }> },
) {
  const { cep } = await params;
  const cepLimpo = cep.replace(/\D/g, '');

  if (cepLimpo.length !== 8) {
    return NextResponse.json({ erro: 'CEP inválido' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      next: { revalidate: 86400 }, // cache por 24h
    });

    if (!res.ok) return NextResponse.json({ erro: 'CEP não encontrado' }, { status: 404 });

    const data = await res.json() as {
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };

    if (data.erro) return NextResponse.json({ erro: 'CEP não encontrado' }, { status: 404 });

    return NextResponse.json({
      logradouro: data.logradouro ?? '',
      bairro: data.bairro ?? '',
      cidade: data.localidade ?? '',
      estado: data.uf ?? '',
    });
  } catch {
    return NextResponse.json({ erro: 'Erro ao consultar CEP' }, { status: 500 });
  }
}
