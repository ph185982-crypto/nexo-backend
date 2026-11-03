// Motivos de ganho e de perda: catálogo curto e fechado, criado na primeira consulta.
// Os nomes em MOTIVO são os que a integração com o Vendedor IA usa.
import { prisma } from "@/lib/prisma";
import type { TipoMotivo } from "./encerramento";

export const MOTIVO = {
  SEM_INTERESSE: "Sem interesse",
  FORA_ICP: "Fora do perfil (ICP)",
  OPT_OUT: "Pediu para não receber mensagens",
} as const;

const PADRAO: Record<TipoMotivo, string[]> = {
  PERDA: [
    MOTIVO.SEM_INTERESSE, MOTIVO.FORA_ICP, "Preço", "Sem orçamento", "Sem retorno do cliente",
    "Escolheu concorrente", "Adiou a decisão", "Não é o decisor", "Contato inválido ou spam", MOTIVO.OPT_OUT,
  ],
  GANHO: ["Dor confirmada e urgente", "Prova de valor aceita", "Preço e condições", "Indicação ou confiança", "Atendimento rápido"],
};

export async function garantirMotivosPadrao(): Promise<void> {
  const data = (Object.keys(PADRAO) as TipoMotivo[]).flatMap((tipo) =>
    PADRAO[tipo].map((nome, ordem) => ({ tipo, nome, ordem })),
  );
  await prisma.motivoEncerramento.createMany({ data, skipDuplicates: true });
}

export async function listarMotivos(tipo?: string | null) {
  await garantirMotivosPadrao();
  return prisma.motivoEncerramento.findMany({
    where: { ativo: true, ...(tipo ? { tipo } : {}) },
    orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }],
  });
}

export async function motivoIdPorNome(tipo: TipoMotivo, nome: string): Promise<string | null> {
  await garantirMotivosPadrao();
  const m = await prisma.motivoEncerramento.findUnique({ where: { tipo_nome: { tipo, nome } }, select: { id: true, ativo: true } });
  return m?.ativo ? m.id : null;
}
