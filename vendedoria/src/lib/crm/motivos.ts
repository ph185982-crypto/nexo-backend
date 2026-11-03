// ─── Motivos de ganho e de perda ─────────────────────────────────────────────
//
// Catálogo curto e fechado por organização. É criado na primeira consulta e
// pode ser ajustado depois (ativo=false esconde sem apagar o histórico).
// Os nomes em MOTIVO são os que os fluxos automáticos (SDR, opt-out) usam.

import { prisma } from "@/lib/prisma/client";
import type { TipoEncerramento } from "@/lib/crm/encerramento";

export const MOTIVO = {
  SEM_INTERESSE: "Sem interesse",
  FORA_ICP: "Fora do perfil (ICP)",
  OPT_OUT: "Pediu para não receber mensagens",
} as const;

const PADRAO: Record<TipoEncerramento, string[]> = {
  PERDA: [
    MOTIVO.SEM_INTERESSE,
    MOTIVO.FORA_ICP,
    "Preço",
    "Sem orçamento",
    "Sem retorno do cliente",
    "Escolheu concorrente",
    "Adiou a decisão",
    "Não é o decisor",
    "Contato inválido ou spam",
    MOTIVO.OPT_OUT,
  ],
  GANHO: [
    "Dor confirmada e urgente",
    "Prova de valor aceita",
    "Preço e condições",
    "Indicação ou confiança",
    "Atendimento rápido",
  ],
};

/** Cria os motivos padrão que ainda não existem. Idempotente. */
const garantidoAte = new Map<string, number>();
const VALIDADE_MS = 10 * 60_000;

export async function garantirMotivosPadrao(organizationId: string): Promise<void> {
  if ((garantidoAte.get(organizationId) ?? 0) > Date.now()) return; // evita um INSERT ... ON CONFLICT a cada leitura/movimento
  const data = (Object.keys(PADRAO) as TipoEncerramento[]).flatMap((tipo) =>
    PADRAO[tipo].map((nome, ordem) => ({ organizationId, tipo, nome, ordem })),
  );
  await prisma.motivoEncerramento.createMany({ data, skipDuplicates: true });
  if (garantidoAte.size > 200) garantidoAte.clear();
  garantidoAte.set(organizationId, Date.now() + VALIDADE_MS);
}

export async function listarMotivos(organizationId: string, tipo?: string | null) {
  await garantirMotivosPadrao(organizationId);
  return prisma.motivoEncerramento.findMany({
    where: { organizationId, ativo: true, ...(tipo ? { tipo } : {}) },
    orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }],
  });
}

/** Id do motivo pelo nome (para os fluxos automáticos). null se não existir ou estiver desativado. */
export async function motivoIdPorNome(
  organizationId: string,
  tipo: TipoEncerramento,
  nome: string,
): Promise<string | null> {
  try {
    await garantirMotivosPadrao(organizationId);
    const m = await prisma.motivoEncerramento.findUnique({
      where: { organizationId_tipo_nome: { organizationId, tipo, nome } },
      select: { id: true, ativo: true },
    });
    return m?.ativo ? m.id : null;
  } catch {
    return null;
  }
}
