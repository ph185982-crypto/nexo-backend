import { prisma } from "@/lib/prisma/client";
import {
  TIPO_POUPANCA,
  acharMetaPoupanca,
  hojeBrasilia,
  listarMetasPoupanca,
  obterMetaPoupanca,
  registrarAporte,
  resumoMeta,
  brl,
} from "@/lib/finance/metas-poupanca";

const dataValida = (s: unknown): Date | null => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function gerenciarMetaPoupanca(args: Record<string, unknown>): Promise<string> {
  const acao = String(args.acao ?? "");
  const nome = typeof args.meta === "string" ? args.meta : null;

  if (acao === "consultar") {
    const metas = await listarMetasPoupanca();
    if (metas.length === 0) return "Nenhuma meta de poupança ativa.";
    return metas.map((m) => resumoMeta(m) + (m.chavePix ? `\nPix da reserva: ${m.chavePix}` : "")).join("\n\n");
  }

  if (acao === "criar") {
    const descricao = String(args.descricao ?? "").trim();
    const alvo = Number(args.valor_alvo);
    const fim = dataValida(args.data_fim);
    if (!descricao || !(alvo > 0) || !fim) return "Para criar a meta preciso de descricao, valor_alvo e data_fim (YYYY-MM-DD).";
    const hoje = hojeBrasilia();
    const meta = await prisma.metaFinanceiraMax.create({
      data: {
        descricao,
        valor_alvo: alvo,
        valor_atual: 0,
        tipo: TIPO_POUPANCA,
        tipo_negocio: "pessoal",
        data_inicio: hoje,
        data_fim: fim,
        aporte_diario: Number(args.aporte_diario) > 0 ? Number(args.aporte_diario) : null,
        cobrar_diariamente: Number(args.aporte_diario) > 0,
      },
    });
    const jaGuardado = Number(args.valor);
    if (jaGuardado > 0) await registrarAporte({ metaId: meta.id, valor: jaGuardado, data: hoje, origem: "inicial", observacao: "Saldo inicial" });
    const m = await obterMetaPoupanca(meta.id);
    return `Meta criada.\n${m ? resumoMeta(m) : ""}`;
  }

  const meta = await acharMetaPoupanca(nome);
  if (!meta) return "Nenhuma meta de poupança ativa. Crie uma com acao=criar.";

  if (acao === "aportar" || acao === "retirar") {
    const valor = Math.abs(Number(args.valor));
    if (!(valor > 0)) return "Informe o valor guardado (ou retirado).";
    const data = dataValida(args.data) ?? hojeBrasilia();
    await registrarAporte({
      metaId: meta.id,
      valor: acao === "retirar" ? -valor : valor,
      data,
      origem: "max",
      observacao: typeof args.observacao === "string" ? args.observacao : null,
    });
    const m = await obterMetaPoupanca(meta.id);
    const feito = acao === "retirar" ? `Registrei a retirada de ${brl(valor)}` : `Registrei ${brl(valor)} guardados`;
    return `${feito} na ${meta.descricao}.\n${m ? resumoMeta(m) : ""}`;
  }

  if (acao === "ajustar") {
    const data: Record<string, unknown> = {};
    if (Number(args.aporte_diario) > 0) data.aporte_diario = Number(args.aporte_diario);
    if (Number(args.valor_alvo) > 0) data.valor_alvo = Number(args.valor_alvo);
    const fim = dataValida(args.data_fim);
    if (fim) data.data_fim = fim;
    if (typeof args.cobrar_diariamente === "boolean") data.cobrar_diariamente = args.cobrar_diariamente;
    if (typeof args.chave_pix === "string" && args.chave_pix.trim()) data.chave_pix = args.chave_pix.trim();
    if (Object.keys(data).length === 0) return "Diga o que ajustar: aporte_diario, valor_alvo, data_fim, cobrar_diariamente ou chave_pix.";
    await prisma.metaFinanceiraMax.update({ where: { id: meta.id }, data });
    const m = await obterMetaPoupanca(meta.id);
    return `Meta ajustada.\n${m ? resumoMeta(m) : ""}`;
  }

  return `Acao "${acao}" invalida. Use consultar, aportar, retirar, ajustar ou criar.`;
}
