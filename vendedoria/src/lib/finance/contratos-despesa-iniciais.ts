// Contratos combinados com o dono em 04/11/2026 (financiamento da Caixa, MRV, carro do
// Fábio, empréstimo do Fernando, internet, água e luz). Entram UMA vez só (marca em
// AlertaEnviadoMax), pelo mesmo caminho do app — então ficam no livro-razão e o dono
// edita ou encerra qualquer um na aba Contas. Mesmo modelo de migrarVendedoriaParaNexo.

import { prisma } from "@/lib/prisma/client";
import { chaveCategoria } from "./dre";
import { criarContratoDespesa, garantirContasDeContratos, type NovoContratoDespesa } from "./contratos-despesa";

const MARCA = "seed-contratos-despesa-v1";

/** Fernando: o que o Pedro ainda paga, mês a mês, conforme a planilha "Fernando e Pedro" (nov/2026 a nov/2027). */
const FERNANDO_CRONOGRAMA = { "12": 371.04, "13": 293.47 };

export const CONTRATOS_INICIAIS: NovoContratoDespesa[] = [
  {
    descricao: "Fernando", credor: "Fernando", categoria: "Dívidas/Parcelas", tipo_negocio: "pessoal",
    valor_parcela: 450, parcelas_total: 13, dia_vencimento: 1, primeiro_vencimento: "2026-11-01",
    saldo_devedor: 5614.51, cronograma: FERNANDO_CRONOGRAMA,
    observacao: "Plano da planilha Fernando e Pedro: 11 parcelas de R$ 450,00 (nov/2026 a set/2027), R$ 371,04 em out/2027 e R$ 293,47 em nov/2027.",
  },
  {
    descricao: "MRV — proposta 84x", credor: "MRV", categoria: "Moradia", tipo_negocio: "pessoal",
    valor_parcela: 518.25, parcelas_total: 84, dia_vencimento: 1, primeiro_vencimento: "2026-12-01",
    entrada: 769.01, entrada_data: "2026-11-09", saldo_devedor: 44302.01,
    observacao: "Entrada de R$ 769,01 em 09/11/2026 e 84 parcelas de R$ 518,25. Total da proposta: R$ 44.302,01. Confirmar a data da 1ª parcela.",
  },
  {
    descricao: "Parcela caixa", credor: "Caixa", categoria: "Casa", tipo_negocio: "pessoal",
    valor_parcela: 650, parcelas_total: 388, dia_vencimento: 1, primeiro_vencimento: "2026-12-01", saldo_devedor: 117040.52,
    observacao: "Financiamento da Caixa: saldo devedor de R$ 117.040,52 em 388 parcelas. CONFIRMAR O VALOR DA PARCELA (usei os R$ 650,00 da conta já lançada).",
  },
  {
    descricao: "Parcela carro (Fábio)", credor: "Fábio", categoria: "Dívidas/Parcelas", tipo_negocio: "pessoal",
    valor_parcela: 334, parcelas_total: 2, dia_vencimento: 1, primeiro_vencimento: "2026-12-01",
    observacao: "2 parcelas restantes de R$ 334,00 (dezembro e janeiro). A de 01/11 já está no extrato. Confirmar a quantidade.",
  },
  {
    descricao: "Internet", credor: null, categoria: "Casa", tipo_negocio: "pessoal",
    valor_parcela: 79.9, parcelas_total: null, dia_vencimento: 10, primeiro_vencimento: "2026-11-10",
    observacao: "R$ 79,90 por mês. Confirmar o dia do vencimento.",
  },
  {
    descricao: "Água", credor: null, categoria: "Casa", tipo_negocio: "pessoal",
    valor_parcela: 200, parcelas_total: null, dia_vencimento: 30, primeiro_vencimento: "2026-11-30", estimada: true,
    observacao: "Valor aproximado: ao receber a fatura, edite a conta com o valor real.",
  },
  {
    descricao: "Energia", credor: null, categoria: "Casa", tipo_negocio: "pessoal",
    valor_parcela: 366, parcelas_total: null, dia_vencimento: 30, primeiro_vencimento: "2026-11-30", estimada: true,
    observacao: "Valor aproximado: ao receber a fatura, edite a conta com o valor real.",
  },
];

/** Cria os contratos iniciais uma única vez e garante as contas do mês. Seguro chamar sempre. */
export async function semearContratosDespesaIniciais(): Promise<{ criados: number }> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave: MARCA } });
  } catch {
    return { criados: 0 }; // já feito antes (ou outra instância está fazendo agora)
  }
  let criados = 0;
  try {
    for (const c of CONTRATOS_INICIAIS) {
      const ja = await prisma.contratoDespesa.findFirst({ where: { descricao: { equals: c.descricao, mode: "insensitive" } }, select: { id: true } });
      if (ja) continue;
      await criarContratoDespesa(c);
      criados++;
    }
    // Contas antigas "recorrentes" com o mesmo nome gerariam duplicata ao serem pagas
    // (criam a próxima sozinhas): desliga a recorrência delas, o contrato assume.
    const nomes = CONTRATOS_INICIAIS.map((c) => chaveCategoria(c.descricao));
    const legadas = await prisma.contaPagarMax.findMany({
      where: { contrato_id: null, status: "pendente", recorrente: true }, select: { id: true, descricao: true },
    });
    const ids = legadas.filter((l) => nomes.some((n) => chaveCategoria(l.descricao).startsWith(n))).map((l) => l.id);
    if (ids.length) await prisma.contaPagarMax.updateMany({ where: { id: { in: ids } }, data: { recorrente: false } });
    await garantirContasDeContratos();
  } catch (e) {
    // Falhou no meio: libera a marca para a próxima chamada completar (o que já existe é pulado).
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: MARCA } }).catch(() => {});
    throw e;
  }
  return { criados };
}
