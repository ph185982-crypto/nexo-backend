// Espelha a qualificação do SDR nas colunas do Lead — é o que transforma o
// Kanban num CRM: o card mostra empresa, faturamento, ICP e a ligação marcada.

import { prisma } from "@/lib/prisma/client";
import { avaliarQualificacao, parseFaturamentoMensal, temCnpjConfirmado } from "./qualificacao";
import { pareceNomeDePessoa } from "./handoff-gate";
import type { SDRSession } from "./types";

export function camposCrmDaSessao(s: SDRSession): Record<string, unknown> {
  const loja = s.loja_fisica === "sim" || s.tem_loja_fisica === true ? "SIM" : s.loja_fisica === "nao" ? "NAO" : null;
  const cnpjTxt = (s.cnpj ?? "").trim();
  const cnpj = !cnpjTxt ? null : temCnpjConfirmado(cnpjTxt) ? "TEM" : "NAO_TEM";
  const fat = parseFaturamentoMensal(s.faturamento_total);
  const respondeuTudo = loja !== null && cnpj !== null && fat !== null;
  const icp = avaliarQualificacao({ ...s, tem_loja_fisica: loja === "SIM" });
  const dados: Record<string, unknown> = {
    empresa: s.empresa?.trim() || null,
    segmento: s.segmento?.trim() || null,
    faturamentoMensal: fat,
    lojaFisica: loja,
    cnpjStatus: cnpj,
    dorPrincipal: s.problema_principal?.trim() || null,
    icpStatus: icp.qualificado ? "QUALIFICADO" : respondeuTudo ? "FORA" : "PENDENTE",
    scoreSdr: Number.isFinite(s.score) ? Math.max(0, Math.min(100, Math.round(s.score))) : null,
    reuniaoEm: s.horario_reuniao && s.reuniao_evento_id ? new Date(s.horario_reuniao) : null,
  };
  // Só grava o que existe — nunca apaga dado do CRM porque o turno não trouxe.
  for (const k of Object.keys(dados)) if (dados[k] === null) delete dados[k];
  return dados;
}

export async function sincronizarQualificacaoNoLead(leadId: string, s: SDRSession): Promise<void> {
  const dados = camposCrmDaSessao(s);
  if (pareceNomeDePessoa(s.nome)) dados.profileName = s.nome.trim();
  if (Object.keys(dados).length === 0) return;
  await prisma.lead.update({ where: { id: leadId }, data: dados }).catch((e) =>
    console.error("[SDR] Falha ao sincronizar CRM do lead:", e),
  );
}
