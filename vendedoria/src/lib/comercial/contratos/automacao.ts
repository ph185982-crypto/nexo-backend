// Contrato ASSINADO automatiza tudo (decisão do dono, Etapa 3):
//  1. Lead.valorContrato = valor mensal do contrato (antes do ganho: o evento Purchase da Meta leva o valor);
//  2. oportunidade ligada vai para a etapa GANHA do funil dela pelo mover (motivo de ganho padrão). O mover
//     move o Lead junto e roda o gancho da API de Conversões, que não duplica (MetaConversionEvent é único);
//     oportunidade já ganha não é movida de novo;
//  3. evento "contrato.assinado" para a Central (outbox idempotente por "contrato.assinado:<envelopeId>").
// Contrato do evento: docs/eventos.md do repositório da Central (nunca mandamos "simulado"; "midias" é apelido
// aceito de "midias-sociais").
// Roda uma vez por contrato (automatizadoEm é reivindicado); falha no meio é refeita pela reconciliação do cron
// (cada passo é idempotente por si). Importados do navegador já entram com automatizadoEm (sem automação).
import { prisma } from "@/lib/prisma/client";
import { moverOportunidade } from "@/lib/comercial/funil/mover";
import { organizacaoComercial } from "@/lib/comercial/organizacao";
import { garantirMotivosPadrao } from "@/lib/crm/motivos";
import { despacharEventosCentral, gravarEventoCentral, type EventoCentral } from "./central";
import { servicosDoContrato, type Servico } from "./modelo";

export const MOTIVO_GANHO_CONTRATO = "Contrato assinado";

export interface PayloadContratoAssinado {
  contratoId: string;
  envelopeId: string;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpj?: string;
  representante?: string;
  emailCliente?: string;
  telefoneCliente?: string;
  modelo: string;
  plano?: string;
  servicos: Servico[];
  valorMensal?: number;
  duracaoMeses?: number;
  inicioEm?: string;
  vencimentoDia?: number;
  oportunidadeId?: string;
  leadId?: string;
  pdfUrl?: string;
}

/** Motivo de ganho padrão: "Contrato assinado" se existir e estiver ativo; senão o primeiro motivo de ganho ativo. */
async function motivoDeGanhoPadrao(): Promise<string | null> {
  const organizationId = await organizacaoComercial();
  await garantirMotivosPadrao(organizationId);
  const nome = process.env.CONTRATOS_MOTIVO_GANHO?.trim() || MOTIVO_GANHO_CONTRATO;
  const m = (await prisma.motivoEncerramento.findFirst({ where: { organizationId, tipo: "GANHO", ativo: true, nome } }))
    ?? (await prisma.motivoEncerramento.findFirst({ where: { organizationId, tipo: "GANHO", ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }));
  return m?.id ?? null;
}

const semVazio = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;

/** Base pública para o link do PDF (abre com login, pela Central ou pelo Vendedor IA). */
function basePublica(): string | null {
  const b = (process.env.COMERCIAL_URL_PUBLICA || process.env.NEXTAUTH_URL || process.env.AUTH_URL || "").trim().replace(/\/+$/, "");
  return b || null;
}

export function montarEventoAssinado(c: {
  id: string; envelopeId: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string | null; representante: string | null;
  emailCliente: string | null; telefoneCliente: string | null; modelo: string; plano: string | null; valor: unknown; duracaoMeses: number | null;
  inicioEm: Date | null; vencimentoDia: number | null; oportunidadeId: string | null; leadId: string | null; assinadoEm: Date | null; temPdfAssinado: boolean;
}): EventoCentral<PayloadContratoAssinado> {
  const base = basePublica();
  return {
    id: `contrato.assinado:${c.envelopeId}`,
    tipo: "contrato.assinado",
    origem: "comercial",
    ocorrido_em: (c.assinadoEm ?? new Date()).toISOString(),
    payload: semVazio({
      contratoId: c.id, envelopeId: c.envelopeId, razaoSocial: c.razaoSocial,
      nomeFantasia: c.nomeFantasia ?? undefined, cnpj: c.cnpj ?? undefined, representante: c.representante ?? undefined,
      emailCliente: c.emailCliente ?? undefined, telefoneCliente: c.telefoneCliente ?? undefined,
      modelo: c.modelo, plano: c.plano ?? undefined, servicos: servicosDoContrato(c.modelo, c.plano),
      valorMensal: Number(c.valor) > 0 ? Number(c.valor) : undefined, // a Central exige > 0 (sem ele, nada vai ao Financeiro)
      duracaoMeses: c.duracaoMeses ?? undefined, inicioEm: c.inicioEm ? c.inicioEm.toISOString().slice(0, 10) : undefined,
      vencimentoDia: c.vencimentoDia ?? undefined, oportunidadeId: c.oportunidadeId ?? undefined, leadId: c.leadId ?? undefined,
      pdfUrl: base?.startsWith("https://") && c.temPdfAssinado ? `${base}/comercial/api/comercial/contratos/${c.id}/arquivo?tipo=ASSINADO` : undefined,
    }) as PayloadContratoAssinado,
  };
}

export async function aoAssinarContrato(contratoId: string): Promise<{ executou: boolean; ganhou?: boolean; evento?: boolean }> {
  // Reivindica: só uma execução passa (webhook repetido, cron e botão "Atualizar" ao mesmo tempo).
  const claim = await prisma.contratoEmitido.updateMany({ where: { id: contratoId, status: "ASSINADO", automatizadoEm: null, provedor: "clicksign" }, data: { automatizadoEm: new Date() } });
  if (claim.count === 0) return { executou: false };
  try {
    const c = await prisma.contratoEmitido.findUniqueOrThrow({ where: { id: contratoId }, include: { arquivos: { where: { tipo: "ASSINADO" }, select: { id: true } } } });
    const valor = c.valor === null ? null : Number(c.valor);

    // 1. Valor do contrato no Lead (antes do ganho: o Purchase da Meta usa este valor).
    if (c.leadId && valor && valor > 0) await prisma.lead.update({ where: { id: c.leadId }, data: { valorContrato: valor } }).catch(() => {});

    // 2. Ganha a oportunidade pelo mover (só se ainda não estiver ganha).
    let ganhou = false;
    if (c.oportunidadeId) {
      const op = await prisma.comOportunidade.findUnique({ where: { id: c.oportunidadeId }, select: { status: true, funilId: true } });
      if (op && op.status !== "GANHA") {
        const etapa = await prisma.comEtapa.findFirst({ where: { funilId: op.funilId, tipo: "GANHA" }, orderBy: { ordem: "asc" }, select: { id: true } });
        if (etapa) {
          const r = await moverOportunidade({
            oportunidadeId: c.oportunidadeId, etapaId: etapa.id, origem: "INTEGRACAO", ator: "clicksign",
            motivo: `Contrato assinado na ClickSign (${c.filename})`, motivoId: await motivoDeGanhoPadrao(),
            motivoDetalhe: `Contrato assinado eletronicamente${c.envelopeId ? ` (envelope ${c.envelopeId})` : ""}`,
          });
          ganhou = r.mudou;
        }
      }
    }

    // 3. Evento para a Central (idempotente) e tentativa imediata de envio.
    let evento = false;
    if (c.envelopeId) {
      const ev = montarEventoAssinado({ ...c, envelopeId: c.envelopeId, temPdfAssinado: c.arquivos.length > 0 });
      evento = await gravarEventoCentral(ev as unknown as EventoCentral);
      await despacharEventosCentral({ eventoId: ev.id }).catch(() => {});
    }
    await prisma.contratoEvento.create({ data: { contratoId, envelopeId: c.envelopeId, tipo: "AUTOMACAO_ASSINADO", payload: { ganhou, evento, valorContrato: valor } } });
    return { executou: true, ganhou, evento };
  } catch (e) {
    // Solta a reivindicação: a reconciliação tenta de novo (cada passo é idempotente).
    await prisma.contratoEmitido.update({ where: { id: contratoId }, data: { automatizadoEm: null, ultimoErro: `Automação: ${(e as Error).message}`.slice(0, 500) } }).catch(() => {});
    console.error("[contratos] automação do assinado falhou:", e);
    return { executou: false };
  }
}
