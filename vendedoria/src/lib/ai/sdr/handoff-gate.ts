// Portão do handoff, regra no código (o LLM não consegue furar):
//  • Com dados faltando, o modelo não encerra: volta a perguntar o que falta.
//  • Respondeu TODAS as perguntas → está qualificado e vai para o Pedro, sem
//    corte de faturamento, loja física, CNPJ, capital ou experiência. Vale mesmo
//    se o modelo tentar descartar ("não faz sentido te passar pro especialista")
//    ou mandar para nutrição. (31/10: o Ozias respondeu tudo, disse que podia
//    falar "agora" e a IA o desqualificou por "falta de capital".)

import { parseFaturamentoMensal } from "./qualificacao";
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
  horario: "o melhor dia e horário para a ligação com o Pedro",
};

/** O que ainda falta para poder passar o lead (na ordem em que convém perguntar). */
export function faltandoParaHandoff(s: SDRSession, agora: Date = new Date()): ItemHandoff[] {
  const f: ItemHandoff[] = [];
  if (!pareceNomeDePessoa(s.nome)) f.push("nome");
  if (!(s.empresa ?? "").trim()) f.push("empresa");
  if (!(s.segmento ?? "").trim() && s.canais_atuais.length === 0) f.push("segmento");
  if (!dorEspecifica(s.problema_principal)) f.push("dor");
  if (!faturamentoRespondido(s.faturamento_total)) f.push("faturamento");
  if (s.loja_fisica !== "sim" && s.loja_fisica !== "nao" && s.tem_loja_fisica !== true) f.push("loja_fisica");
  if (!(s.cnpj ?? "").trim()) f.push("cnpj");
  if (!temHorario(s, agora)) f.push("horario");
  return f;
}

/** Respondeu sobre faturamento? Um valor, ou que ainda não fatura ("zero", "ainda não", "tô começando"). */
export function faturamentoRespondido(v: string | null | undefined): boolean {
  if (parseFaturamentoMensal(v) !== null) return true;
  const t = (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(nao fatur|ainda nao|zero|nada|nenhum|sem faturamento|comecando|iniciando|nao vend)/.test(t);
}

/**
 * O lead já disse quando pode falar? Vale um horário da agenda (vira reunião no
 * CRM) ou qualquer disponibilidade dita por ele ("agora", "amanhã de manhã") —
 * o Pedro recebe isso no bastão e combina o horário exato.
 */
export function temHorario(s: SDRSession, agora: Date = new Date()): boolean {
  return Boolean(horarioAceitavel(s.horario_reuniao, agora)) || (s.disponibilidade ?? "").trim().length >= 2;
}

export type AcaoSdr = "continue" | "handoff" | "nurture" | "close";

export interface DecisaoHandoff {
  acao: AcaoSdr;
  /** Instrução para o modelo refazer a resposta (quando o código mudou a ação dele). */
  correcao?: string;
  faltando: ItemHandoff[];
  motivo: string;
}

/**
 * Decide a ação final a partir da ação pedida pelo modelo:
 * - respondeu tudo → handoff, qualquer que seja a ação pedida;
 * - pediu handoff ou nutrição com dados faltando → continue (perguntar o que falta);
 * - "close" (o lead disse que não tem interesse) e "continue" ficam como estão.
 */
export function decidirHandoff(pedida: AcaoSdr, s: SDRSession, agora: Date = new Date()): DecisaoHandoff {
  const faltando = faltandoParaHandoff(s, agora);

  if (faltando.length === 0) {
    if (pedida === "handoff") return { acao: "handoff", faltando, motivo: "respondeu todas as perguntas" };
    return {
      acao: "handoff", faltando, motivo: `respondeu todas as perguntas (modelo pediu ${pedida})`,
      correcao:
        `SISTEMA: o lead já respondeu todas as perguntas — ele está QUALIFICADO e vai para o Pedro agora. ` +
        `NÃO desqualifique, NÃO fale de capital, experiência ou "momento", NÃO faça mais perguntas. ` +
        `Envie agora a mensagem de ENCERRAMENTO HANDOFF completa e use action="handoff".`,
    };
  }

  if (pedida === "handoff" || pedida === "nurture") {
    const primeiro = faltando[0];
    return {
      acao: "continue", faltando, motivo: `modelo pediu ${pedida}, mas faltam: ${faltando.join(", ")}`,
      correcao:
        `SISTEMA: você tentou ${pedida === "handoff" ? "encerrar (handoff)" : "mandar o lead para nutrição"}, mas ainda falta: ` +
        `${faltando.map((i) => PERGUNTA_POR_ITEM[i]).join("; ")}. Todo lead que responde as perguntas é qualificado — ` +
        `NÃO encerre, NÃO desqualifique e NÃO diga que vai passar para o especialista ainda. Responda ao que o lead ` +
        `acabou de dizer e pergunte de forma natural sobre ${PERGUNTA_POR_ITEM[primeiro]}. Use action="continue".`,
    };
  }

  return { acao: pedida, faltando, motivo: "ação do modelo mantida" };
}
