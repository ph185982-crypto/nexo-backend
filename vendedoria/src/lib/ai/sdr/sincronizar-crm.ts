// Espelha a qualificação do SDR nas colunas do Lead — é o que transforma o
// Kanban num CRM: o card mostra empresa, faturamento, ICP e a ligação marcada.

import { prisma } from "@/lib/prisma/client";
import { classificar, cnpjAtivo, faturamentoParaLead, lojaOuEstoque } from "./julia/icp";
import { pareceNomeDePessoa } from "./handoff-gate";
import type { SDRSession } from "./types";

export function camposCrmDaSessao(s: SDRSession): Record<string, unknown> {
  // Regras do roteiro da Júlia (./julia/icp.ts): loja = loja física OU fábrica/atacado com estoque próprio; faturamento
  // ATUAL por faixa (ponto médio); ICP pela loja/estoque + CNPJ — faturamento não elimina ninguém.
  const loja = lojaOuEstoque(s);
  const cnpj = cnpjAtivo(s);
  const fat = faturamentoParaLead(s);
  const dados: Record<string, unknown> = {
    empresa: s.empresa?.trim() || null,
    segmento: s.segmento?.trim() || null,
    faturamentoMensal: fat,
    lojaFisica: loja === null ? null : loja ? "SIM" : "NAO",
    cnpjStatus: cnpj === null ? null : cnpj ? "TEM" : "NAO_TEM",
    dorPrincipal: (s.frase_chave || s.problema_principal)?.trim() || null,
    icpStatus: classificar(s),
    scoreSdr: Number.isFinite(s.score) && s.score > 0 ? Math.max(0, Math.min(100, Math.round(s.score))) : null,
    reuniaoEm: s.horario_reuniao && s.reuniao_evento_id ? new Date(s.horario_reuniao) : null,
  };
  // Só grava o que existe — nunca apaga dado do CRM porque o turno não trouxe.
  for (const k of Object.keys(dados)) if (dados[k] === null) delete dados[k];
  return dados;
}

/** Dados da sessão que o CRM Avanteza precisa, antes de a sincronização com o Lead rodar. */
export function dadosParaEventoCrm(s: SDRSession) {
  const c = camposCrmDaSessao(s);
  return {
    nome: pareceNomeDePessoa(s.nome) ? s.nome.trim() : undefined,
    empresa: c.empresa, segmento: c.segmento, faturamentoMensal: c.faturamentoMensal, dorPrincipal: c.dorPrincipal, scoreSdr: c.scoreSdr,
  };
}

export async function sincronizarQualificacaoNoLead(leadId: string, s: SDRSession): Promise<void> {
  const dados = camposCrmDaSessao(s);
  if (pareceNomeDePessoa(s.nome)) dados.profileName = s.nome.trim();
  if (Object.keys(dados).length === 0) return;
  await prisma.lead.update({ where: { id: leadId }, data: dados }).catch((e) =>
    console.error("[SDR] Falha ao sincronizar CRM do lead:", e),
  );
}
