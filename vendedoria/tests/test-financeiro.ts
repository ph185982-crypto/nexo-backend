/**
 * Financeiro — contratos de receita, competência, perda e livro-razão.
 * Run: DATABASE_URL=... DIRECT_URL=... npx tsx tests/test-financeiro.ts
 * Precisa de um Postgres com o schema aplicado (prisma db push). Escreve dados
 * de teste no banco — use um banco descartável.
 */
import { prisma } from "@/lib/prisma/client";
import { criarContrato, garantirParcelasContratos, encerrarContrato } from "@/lib/finance/contratos";
import { gerarParcelas, dividirEmParcelas } from "@/lib/finance/parcelas";
import { restaurarDoHistorico } from "@/lib/finance/restaurar";
import { resolverPeriodo, periodoAnterior } from "@/lib/finance/periodo";

const ok = (c: boolean, m: string) => { console.log(c ? "OK  " : "FAIL", m); if (!c) process.exitCode = 1; };

async function main() {
  // --- parcelas puras
  ok(JSON.stringify(dividirEmParcelas(100, 3)) === "[33.34,33.33,33.33]", "divide 100 em 3 com sobra nas primeiras");
  const p31 = gerarParcelas({ primeiroVencimento: "2026-01-31", meses: 4, valorParcela: 10 });
  ok(p31.map((p) => p.data).join() === "2026-01-31,2026-02-28,2026-03-31,2026-04-30", "dia 31 é limitado ao fim de cada mês: " + p31.map(p=>p.data).join());
  const virada = gerarParcelas({ primeiroVencimento: "2026-11-15", meses: 3, valorParcela: 1 });
  ok(virada.map((p) => p.data).join() === "2026-11-15,2026-12-15,2027-01-15", "virada de ano");

  // --- períodos
  const hoje = new Date(Date.UTC(2026, 9, 1)); // 01/10/2026
  const pe = resolverPeriodo({}, hoje);
  ok(pe.mes === "2026-10" && periodoAnterior(pe).mes === "2026-09", "em 1º/10 a competência vira outubro, comparando com setembro");
  const pd = resolverPeriodo({ dia: "2026-09-30" }, hoje);
  ok(pd.tipo === "dia" && periodoAnterior(pd).label.startsWith("29/09"), "período dia");

  // --- contrato parcelado (1000 em 3x) + recorrente 12m + indeterminado
  const c1 = await criarContrato({ descricao: "Cliente Parc", cliente: "ACME", tipo_negocio: "nexo", modo: "parcelada", valor_total: 1000, meses: 3, primeiro_vencimento: "2026-10-10" });
  const par = await prisma.receitaPrevistaMax.findMany({ where: { contrato_id: c1.contrato.id }, orderBy: { parcela_numero: "asc" } });
  ok(par.length === 3 && par.map((p) => p.valor).join() === "333.34,333.33,333.33", "parcelada 1000/3 gera 3 parcelas: " + par.map(p=>p.valor).join());
  ok(par[0].descricao.includes("parcela 1/3"), "descrição da parcela: " + par[0].descricao);

  const c2 = await criarContrato({ descricao: "Assessoria", cliente: "Beta", tipo_negocio: "nexo", modo: "recorrente", valor_parcela: 1500, meses: 12, primeiro_vencimento: "2026-10-05" });
  ok((await prisma.receitaPrevistaMax.count({ where: { contrato_id: c2.contrato.id } })) === 12, "recorrente 12 meses gera 12 parcelas");

  const c3 = await criarContrato({ descricao: "Mensalidade", tipo_negocio: "pessoal", modo: "recorrente", valor_parcela: 200, meses: null, primeiro_vencimento: "2026-09-01" });
  const n3 = await prisma.receitaPrevistaMax.count({ where: { contrato_id: c3.contrato.id } });
  ok(n3 === 12, "indeterminado começa com 12 parcelas (n=" + n3 + ")");
  const criadas = await garantirParcelasContratos();
  ok(criadas >= 0 && (await prisma.receitaPrevistaMax.count({ where: { contrato_id: c3.contrato.id } })) >= 12, "garantir é idempotente (criou " + criadas + ")");
  const again = await garantirParcelasContratos();
  ok(again === 0, "segunda chamada não duplica");

  // --- perda + auditoria
  const alvo = par[1];
  await prisma.receitaPrevistaMax.update({ where: { id: alvo.id }, data: { status: "perdida", data_perda: new Date(), motivo_perda: "cliente saiu" } });
  const hist = await prisma.historicoFinanceiro.findMany({ where: { entidade: "ReceitaPrevistaMax", entidade_id: alvo.id }, orderBy: { criado_em: "asc" } });
  ok(hist.length === 2 && hist[0].acao === "criado" && hist[1].acao === "atualizado", "histórico: criado + atualizado (" + hist.map(h=>h.acao).join() + ")");
  ok((hist[1].antes as any).status === "pendente" && (hist[1].depois as any).status === "perdida", "histórico guarda antes/depois da perda");

  // --- encerrar contrato
  const enc = await encerrarContrato(c2.contrato.id, "cancelou");
  ok((enc as any).parcelasPerdidas >= 11, "encerrar perde as parcelas futuras (" + (enc as any)?.parcelasPerdidas + ")");
  ok((await prisma.receitaPrevistaMax.count({ where: { contrato_id: c2.contrato.id } })) === 12, "nenhuma parcela foi apagada no encerramento");

  // --- delete auditado e restaurado
  const t = await prisma.transacao.create({ data: { tipo: "despesa", valor: 50, descricao: "Almoço", categoria: "Alimentação", tipo_negocio: "pessoal", data_transacao: new Date(Date.UTC(2026, 8, 30)), mes: "2026-09" } });
  await prisma.transacao.delete({ where: { id: t.id } });
  const hd = await prisma.historicoFinanceiro.findFirst({ where: { entidade: "Transacao", entidade_id: t.id, acao: "excluido" } });
  ok(!!hd && (hd.antes as any).descricao === "Almoço", "exclusão deixou cópia no histórico");
  const r = await restaurarDoHistorico(hd!.id);
  ok(r.ok && !!(await prisma.transacao.findUnique({ where: { id: t.id } })), "restaurou a transação com o mesmo id");
  const r2 = await restaurarDoHistorico(hd!.id);
  ok(!r2.ok, "não restaura duas vezes");

  // --- unicidade de parcela
  let dup = false;
  try { await prisma.receitaPrevistaMax.create({ data: { descricao: "dup", valor: 1, data_prevista: new Date(), contrato_id: c1.contrato.id, parcela_numero: 1 } }); } catch { dup = true; }
  ok(dup, "unique(contrato_id, parcela_numero) impede parcela duplicada");

  // --- deleteMany em lote também audita (marcador único → teste re-executável)
  const marca = "lote-" + Date.now();
  await prisma.transacao.createMany({ data: [
    { tipo: "receita", valor: 1, descricao: "lote1", categoria: marca, data_transacao: new Date(), mes: "2026-09" },
    { tipo: "receita", valor: 2, descricao: "lote2", categoria: marca, data_transacao: new Date(), mes: "2026-09" },
  ]});
  await prisma.transacao.deleteMany({ where: { categoria: marca } });
  const exc = await prisma.historicoFinanceiro.count({ where: { entidade: "Transacao", acao: "excluido", antes: { path: ["categoria"], equals: marca } } });
  ok(exc === 2, "deleteMany gravou 2 cópias (" + exc + ")");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
