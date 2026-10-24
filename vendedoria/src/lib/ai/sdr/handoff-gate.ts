// Portão do handoff: o lead só chega ao Pedro com os dados completos E dentro
// do ICP. O prompt pede isso, mas o modelo encerrava assim mesmo (em 23/10 dois
// handoffs seguidos: R$ 5 mil sem loja física, e "DJ$" sem CNPJ). Agora é regra
// no código — o LLM não consegue furar.

import { avaliarQualificacao, temCnpjConfirmado, parseFaturamentoMensal } from "./qualificacao";
import { horarioAceitavel } from "@/lib/agenda/slots";
import type { SDRSession } from "./types";

const PALAVRAS_DE_NEGOCIO = /\b(loja|store|shop|modas?|boutique|confec[cç][oõ]es|acess[oó]rios|advocacia|advogad|cl[ií]nica|studio|est[uú]dio|distribuidora|atacado|varejo|com[eé]rcio|ltda|eireli|me\b|epp|suplementos|im[oó]veis|imobili[aá]ria|oficial|baby|kids|beauty|cosm[eé]ticos|pe[cç]as|auto|motos?|personal|consultoria|marketing|digital|fitness|ateli[eê]|delivery|pet|fam[ií]lia)\b/i;
const FRASES_DE_PERFIL = /(deus|jesus|senhor|aben[cç]o|gratid[aã]o|f[eé]\b|am[eé]m|f[aá]bric)/i;

/** O texto parece nome de PESSOA? ("Ana", "João Pedro Silva" sim; "DJ$", "💨", "Loja X", "Deus abençoe..." não) */
export function pareceNomeDePessoa(nome: string | null | undefined): boolean {
  const t = (nome ?? "").trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/[\d$@#%&*_+=/\\|<>{}[\]~^]/.test(t)) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (PALAVRAS_DE_NEGOCIO.test(t) || FRASES_DE_PERFIL.test(t)) return false;
  const palavras = t.split(/\s+/);
  if (palavras.length > 4) return false;
  // Cada palavra: só letras (com acento), apóstrofo ou hífen; ao menos 2 letras na 1ª
  if (!palavras.every((p) => /^[\p{L}'’-]+$/u.test(p))) return false;
  return palavras[0].replace(/['’-]/g, "").length >= 2;
}

const DOR_GENERICA = /^(vender mais|aumentar (as )?vendas|crescer|melhorar|quero vender|vender online|mais vendas|faturar mais)\.?$/i;

/** A dor é específica o bastante para o especialista preparar a ligação? */
export function dorEspecifica(dor: string | null | undefined): boolean {
  const t = (dor ?? "").trim();
  return t.length >= 15 && !DOR_GENERICA.test(t);
}

export type ItemHandoff =
  | "nome" | "empresa" | "segmento" | "dor" | "faturamento" | "loja_fisica" | "cnpj" | "horario";

/** Pergunta-guia (para o modelo reformular) quando falta cada item. */
export const PERGUNTA_POR_ITEM: Record<ItemHandoff, string> = {
  nome: "o nome da pessoa (o do perfil não é um nome de pessoa)",
  empresa: "o nome da empresa/loja",
  segmento: "o que a empresa vende (segmento/produtos)",
  dor: "a dor real e específica do negócio hoje (o que trava as vendas, com algum número ou exemplo)",
  faturamento: "o faturamento mensal aproximado do negócio inteiro (valor em reais)",
  loja_fisica: "se tem loja física (sim ou não)",
  cnpj: "se a empresa tem CNPJ ativo",
  horario: "o horário da ligação com o Pedro — ofereça os horários livres listados",
};

/** O que ainda falta para poder passar o lead (na ordem em que convém perguntar). */
export function faltandoParaHandoff(s: SDRSession, agora: Date = new Date()): ItemHandoff[] {
  const f: ItemHandoff[] = [];
  if (!pareceNomeDePessoa(s.nome)) f.push("nome");
  if (!(s.empresa ?? "").trim()) f.push("empresa");
  if (!(s.segmento ?? "").trim() && s.canais_atuais.length === 0) f.push("segmento");
  if (!dorEspecifica(s.problema_principal)) f.push("dor");
  if (parseFaturamentoMensal(s.faturamento_total) === null) f.push("faturamento");
  if (s.loja_fisica !== "sim" && s.loja_fisica !== "nao" && s.tem_loja_fisica !== true) f.push("loja_fisica");
  if (!(s.cnpj ?? "").trim()) f.push("cnpj");
  if (!horarioAceitavel(s.horario_reuniao, agora)) f.push("horario");
  return f;
}

export type AcaoSdr = "continue" | "handoff" | "nurture" | "close";

export interface DecisaoHandoff {
  acao: AcaoSdr;
  /** Instrução para o modelo refazer a resposta (só quando o handoff foi barrado). */
  correcao?: string;
  faltando: ItemHandoff[];
  foraDoIcp: boolean;
  motivo: string;
}

/**
 * Decide a ação final. Só mexe quando o modelo pediu handoff:
 * - faltam dados → continue (perguntar o primeiro que falta);
 * - dados completos mas fora do ICP → nurture (nunca vai para a agenda do Pedro);
 * - completo e no ICP → handoff.
 * Horário só é exigido de quem está no ICP.
 */
export function decidirHandoff(pedida: AcaoSdr, s: SDRSession, agora: Date = new Date()): DecisaoHandoff {
  const sessaoLoja = { ...s, tem_loja_fisica: s.loja_fisica === "sim" ? true : s.loja_fisica === "nao" ? false : s.tem_loja_fisica };
  const icp = avaliarQualificacao(sessaoLoja);
  const faltandoTudo = faltandoParaHandoff(s, agora);
  const faltandoDados = faltandoTudo.filter((i) => i !== "horario");
  const respondeuIcp = !faltandoDados.some((i) => i === "faturamento" || i === "loja_fisica" || i === "cnpj");
  const foraDoIcp = respondeuIcp && !icp.qualificado;

  if (pedida !== "handoff") {
    return { acao: pedida, faltando: faltandoTudo, foraDoIcp, motivo: "ação do modelo mantida" };
  }

  if (foraDoIcp) {
    const porque = icp.faltando.map((f) => (
      f === "faturamento" ? `faturamento abaixo de R$ 40 mil/mês (lido: ${icp.faturamentoMensal ?? "?"})`
        : f === "loja_fisica" ? "não tem loja física"
        : "não tem CNPJ ativo"
    )).join(", ");
    return {
      acao: "nurture", faltando: faltandoTudo, foraDoIcp: true, motivo: `fora do ICP: ${porque}`,
      correcao:
        `SISTEMA: este lead NÃO está no perfil atendido agora (${porque}). NÃO faça handoff, NÃO marque ligação ` +
        `e NÃO diga que o especialista vai chamar. Agradeça, explique com respeito que neste momento a consultoria ` +
        `não é o melhor passo pra ele, deixe a porta aberta e ofereça mandar conteúdo útil. Use action="nurture".`,
    };
  }

  const faltando = icp.qualificado ? faltandoTudo : faltandoDados;
  if (faltando.length > 0) {
    const primeiro = faltando[0];
    return {
      acao: "continue", faltando, foraDoIcp: false, motivo: `faltam: ${faltando.join(", ")}`,
      correcao:
        `SISTEMA: você tentou encerrar (handoff), mas ainda falta: ${faltando.map((i) => PERGUNTA_POR_ITEM[i]).join("; ")}. ` +
        `NÃO encerre, NÃO diga que vai passar para o especialista. Responda ao que o lead acabou de dizer e pergunte ` +
        `de forma natural sobre ${PERGUNTA_POR_ITEM[primeiro]}. Use action="continue".`,
    };
  }

  return { acao: "handoff", faltando: [], foraDoIcp: false, motivo: "dados completos e dentro do ICP" };
}
