// Aviso de limite de gasto: quando uma categoria chega a 80% e a 100% do limite mensal
// (cartão de crédito, alimentação etc.), o Max avisa o dono. Usa as mesmas chaves de
// trava do cron antigo (alertas.ts), então os dois nunca avisam duas vezes a mesma coisa.
// Só de 8h às 21h (Brasília); se nenhum canal entregar, a trava é liberada.

import { prisma } from "@/lib/prisma/client";
import { gastoDaCategoria, gastoPorCategoriaNoMes, nivelDoOrcamento } from "@/lib/finance/orcamentos";
import { entregarPorTodosOsCanais, partesBrasilia, type Entregador, type EntregaVespera } from "./contas-vespera";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export interface ResultadoOrcamentos {
  situacao: "fora-do-horario" | "nada" | "avisado" | "sem-canal";
  avisos: number;
  entrega?: EntregaVespera;
}

export function montarMensagemOrcamentos(linhas: Array<{ categoria: string; gasto: number; limite: number; nivel: "alerta" | "estourado" }>): string {
  const itens = linhas.map((l) => {
    const pct = Math.round((l.gasto / l.limite) * 100);
    const icone = l.nivel === "estourado" ? "🔴" : "🟡";
    const quanto = l.nivel === "estourado" ? `estourou o limite (${pct}%)` : `chegou a ${pct}% do limite`;
    return `${icone} ${l.categoria}: ${quanto} — ${BRL.format(l.gasto)} de ${BRL.format(l.limite)}`;
  });
  return `Limites de gasto do mês:\n\n${itens.join("\n")}\n\nSegura a mão por aqui pra manter a vida financeira equilibrada.`;
}

export async function avisarOrcamentos(opts: { agora?: Date; entregar?: Entregador } = {}): Promise<ResultadoOrcamentos> {
  const agora = opts.agora ?? new Date();
  const { dia, hora } = partesBrasilia(agora);
  if (hora < 8 || hora >= 21) return { situacao: "fora-do-horario", avisos: 0 };

  const orcamentos = await prisma.orcamentoMax.findMany();
  if (orcamentos.length === 0) return { situacao: "nada", avisos: 0 };
  const mes = dia.slice(0, 7);
  const gastos = await gastoPorCategoriaNoMes(mes);

  const linhas: Array<{ categoria: string; gasto: number; limite: number; nivel: "alerta" | "estourado" }> = [];
  const chaves: string[] = [];
  for (const o of orcamentos) {
    const gasto = gastoDaCategoria(gastos, o.categoria);
    const nivel = nivelDoOrcamento(gasto, o.limite_mensal);
    if (nivel === "ok") continue;
    const chave = nivel === "estourado" ? `orc-estourado-${o.categoria}-${mes}` : `orc-80-${o.categoria}-${mes}`;
    try {
      await prisma.alertaEnviadoMax.create({ data: { chave } });
      chaves.push(chave);
      linhas.push({ categoria: o.categoria.trim(), gasto, limite: o.limite_mensal, nivel });
    } catch { /* já avisado neste mês e nível */ }
  }
  if (linhas.length === 0) return { situacao: "nada", avisos: 0 };

  const estourou = linhas.some((l) => l.nivel === "estourado");
  const entrega = await (opts.entregar ?? entregarPorTodosOsCanais)({
    titulo: estourou ? "🔴 Limite de gasto estourado" : "🟡 Limite de gasto chegando",
    mensagem: montarMensagemOrcamentos(linhas),
    resumo: linhas.map((l) => `${l.categoria} ${Math.round((l.gasto / l.limite) * 100)}%`).join(" · "),
    url: "/crm/financeiro",
    tag: "orcamento-limite",
  });
  if (!entrega.whatsapp && !entrega.notificacao) {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { in: chaves } } }).catch(() => {});
    return { situacao: "sem-canal", avisos: linhas.length, entrega };
  }
  console.log(`[Max] Aviso de orçamento enviado | categorias=${linhas.length}`);
  return { situacao: "avisado", avisos: linhas.length, entrega };
}
