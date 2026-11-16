// Motivos de ganho e de perda do Comercial = o catálogo do Vendedor IA (MotivoEncerramento, por organização),
// o mesmo que o kanban de Leads usa. Os nomes padrão são idênticos aos do CRM.
import { prisma } from "@/lib/prisma/client";
import { garantirMotivosPadrao as garantirDaOrg, MOTIVO } from "@/lib/crm/motivos";
import { organizacaoComercial } from "@/lib/comercial/organizacao";
import type { TipoMotivo } from "./encerramento";

export { MOTIVO };

export async function garantirMotivosPadrao(): Promise<void> {
  await garantirDaOrg(await organizacaoComercial());
}

export async function listarMotivos(tipo?: string | null) {
  const organizationId = await organizacaoComercial();
  await garantirDaOrg(organizationId);
  return prisma.motivoEncerramento.findMany({
    where: { organizationId, ativo: true, ...(tipo ? { tipo } : {}) },
    orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }],
  });
}

export async function motivoIdPorNome(tipo: TipoMotivo, nome: string): Promise<string | null> {
  const organizationId = await organizacaoComercial();
  await garantirDaOrg(organizationId);
  const m = await prisma.motivoEncerramento.findUnique({ where: { organizationId_tipo_nome: { organizationId, tipo, nome } }, select: { id: true, ativo: true } });
  return m?.ativo ? m.id : null;
}
