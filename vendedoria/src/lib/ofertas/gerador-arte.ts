// Geração de arte de oferta (imagem a partir de HTML).
//
// A implementação original usava puppeteer-core + @sparticuz/chromium. Em
// 30/10 as dependências foram removidas: o módulo de ofertas nunca gerou um
// registro em produção (OfertaGerada = 0) e elas traziam 20+ vulnerabilidades
// e ~300 MB ao bundle serverless. Para reativar, restaure este arquivo do
// histórico do git (commit anterior a esta mudança) e reinstale as duas
// dependências.

export interface DadosArte {
  nome: string;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoUrl: string | null;
}

export async function gerarArte(_dados: DadosArte): Promise<string> {
  throw new Error("Geração de arte de oferta desativada — ver src/lib/ofertas/gerador-arte.ts");
}
