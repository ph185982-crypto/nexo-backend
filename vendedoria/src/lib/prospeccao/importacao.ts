import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma/client";
import { detectarTipoTelefoneBR } from "./sourcing";

// ─── Importação manual de leads via planilha ───────────────────────────────
//
// Fluxo: usuário baixa o modelo, preenche, sobe de volta. Cada linha vira um
// ProspectLead com status APROVADO — pula o pipeline de enriquecimento/score
// (é pra isso que serve: base já curada manualmente pelo usuário), e cai
// direto elegível pro disparo. Número de telefone que não bate como CELULAR
// é rejeitado aqui — a mesma regra que `executarDisparoDiario` aplica
// (`NOT tipoTelefone: FIXO`) protegendo a qualidade do número do WhatsApp.

const COLUNAS = ["Nome", "Telefone", "Endereço", "Site", "Tipo de negócio", "Observação"] as const;

const LINHA_EXEMPLO = [
  "Loja Exemplo Confecções",
  "62991234567",
  "Rua 44, Setor Norte Ferroviário, Goiânia - GO",
  "instagram.com/lojaexemplo",
  "Moda feminina",
  "Vitrine sem atualização há meses — oportunidade de reforço digital",
];

export function gerarPlanilhaModelo(): Buffer {
  const aba = XLSX.utils.aoa_to_sheet([[...COLUNAS], LINHA_EXEMPLO]);
  aba["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 36 }, { wch: 26 }, { wch: 20 }, { wch: 40 }];
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, aba, "Leads");
  return XLSX.write(livro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function normalizarTelefoneBR(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  const comDDI = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return `+${comDDI}`;
}

interface LinhaPlanilha {
  Nome?: string;
  Telefone?: string | number;
  Endereço?: string;
  Site?: string;
  "Tipo de negócio"?: string;
  Observação?: string;
}

export interface ResultadoImportacao {
  inseridos: number;
  ignorados: number;
  detalhes: Array<{ linha: number; nome: string | null; motivo: string }>;
}

async function segmentoImportacaoManual(organizationId: string): Promise<string> {
  const nome = "Importação manual (planilha)";
  const existente = await prisma.prospectSegment.findFirst({ where: { organizationId, nome } });
  if (existente) return existente.id;
  const criado = await prisma.prospectSegment.create({
    data: {
      organizationId,
      nome,
      termoBusca: "importação manual",
      cidades: [],
      metaEmpresas: 5000,
      ativo: true,
    },
  });
  return criado.id;
}

export async function importarPlanilha(buffer: ArrayBuffer, organizationId: string): Promise<ResultadoImportacao> {
  const livro = XLSX.read(buffer, { type: "buffer" });
  const primeiraAba = livro.SheetNames[0];
  if (!primeiraAba) {
    return { inseridos: 0, ignorados: 0, detalhes: [{ linha: 0, nome: null, motivo: "planilha vazia" }] };
  }
  const linhas = XLSX.utils.sheet_to_json<LinhaPlanilha>(livro.Sheets[primeiraAba]);

  const segmentId = await segmentoImportacaoManual(organizationId);

  let inseridos = 0;
  let ignorados = 0;
  const detalhes: ResultadoImportacao["detalhes"] = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const numeroLinha = i + 2; // +1 cabeçalho, +1 índice 1-based
    const nome = linha.Nome?.toString().trim() || null;
    const telefoneRaw = linha.Telefone?.toString().trim();

    if (!nome || !telefoneRaw) {
      ignorados++;
      detalhes.push({ linha: numeroLinha, nome, motivo: "nome ou telefone em branco" });
      continue;
    }

    const telefone = normalizarTelefoneBR(telefoneRaw);
    if (!telefone) {
      ignorados++;
      detalhes.push({ linha: numeroLinha, nome, motivo: `telefone inválido: "${telefoneRaw}"` });
      continue;
    }

    const tipoTelefone = detectarTipoTelefoneBR(telefone);
    if (tipoTelefone !== "CELULAR") {
      ignorados++;
      detalhes.push({
        linha: numeroLinha, nome,
        motivo: tipoTelefone === "FIXO"
          ? "telefone fixo — disparo WhatsApp exige celular, protege a qualidade do número"
          : "não foi possível confirmar que é celular (DDD + 9 dígitos)",
      });
      continue;
    }

    const placeId = `manual:${telefone}`;
    const existente = await prisma.prospectLead.findUnique({ where: { placeId } });
    if (existente) {
      ignorados++;
      detalhes.push({ linha: numeroLinha, nome, motivo: "telefone já importado antes (duplicado)" });
      continue;
    }

    await prisma.prospectLead.create({
      data: {
        organizationId,
        segmentId,
        placeId,
        nome,
        telefone,
        tipoTelefone,
        enderecoCompleto: linha.Endereço?.toString().trim() || null,
        website: linha.Site?.toString().trim() || null,
        tipoNegocio: linha["Tipo de negócio"]?.toString().trim() || null,
        sinalOportunidade: linha.Observação?.toString().trim() || null,
        status: "APROVADO",
      },
    });
    inseridos++;
  }

  return { inseridos, ignorados, detalhes };
}
