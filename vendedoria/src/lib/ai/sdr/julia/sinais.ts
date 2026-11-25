// Sinais lidos da mensagem do lead, sem modelo: resposta automática, foto/mídia, troca de horário e escolha
// de um dos horários oferecidos.
import { partesBRT } from "@/lib/agenda/slots";
import { sem } from "./roteiro";

/** Normaliza para comparar: sem U+200E/U+200F/U+200B, sem acento, sem pontuação e espaços, minúsculas. */
export function normalizarMensagem(t: string): string {
  return sem(t).replace(/[‎‏​⁠﻿]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

const AUTOMATICA = /(agradece (o |seu )?contato|como podemos ajudar|mensagem autom[aá]tica|no momento n[aã]o (estamos|podemos)|hor[aá]rio de atendimento|obrigad[oa] por entrar em contato|em breve retornaremos)/i;

/** Resposta automática: igual à mensagem anterior do lead, ou com cara de mensagem de ausência/saudação automática. */
export function ehRespostaAutomatica(mensagem: string, anteriorDoLead?: string | null): boolean {
  const n = normalizarMensagem(mensagem);
  if (!n) return false;
  if (anteriorDoLead && normalizarMensagem(anteriorDoLead) === n && n.length >= 12) return true;
  const limpa = mensagem.replace(/[‎‏​⁠﻿]/g, "");
  return AUTOMATICA.test(limpa) || AUTOMATICA.test(sem(limpa));
}

/** Mensagem que é só mídia (o webhook grava "[Imagem recebida]", "[Vídeo recebido]"…, com ou sem legenda). */
export function ehMidia(mensagem: string): boolean {
  return /^\s*\[(imagem|foto|v[ií]deo|documento|sticker|figurinha)[^\]]*\]/i.test(mensagem);
}

const TROCA = /(remarc|reagend|trocar? (o |de )?hor|mudar? (o |de )?hor|outro hor|outro dia|adiar|n[aã]o (vou )?(consigo|posso|d[aá])( nesse| neste| no| esse| este| nesse hor| amanh[aã]| hoje)?|n[aã]o vai dar|pode ser (outro|mais tarde|amanh)|muda(r)? pra)/i;
export function pediuTrocarHorario(mensagem: string): boolean {
  return TROCA.test(sem(mensagem)) || TROCA.test(mensagem);
}

const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

/**
 * Qual dos horários oferecidos o lead escolheu? Aceita "12:15", "12h15", "meio-dia", "18:30", "18h30", "noite",
 * "o primeiro"/"1", "o segundo"/"2", "hoje", "amanhã", nome do dia. Devolve o ISO escolhido ou null (ambíguo/nenhum).
 */
export function escolherSlot(mensagem: string, oferecidos: string[], agora: Date = new Date()): string | null {
  if (!oferecidos.length) return null;
  const t = sem(mensagem).replace(/[‎‏​]/g, "").trim();
  if (!t) return null;
  const cands = oferecidos.map((iso) => {
    const d = new Date(iso);
    const p = partesBRT(d);
    const hoje = partesBRT(agora); const am = partesBRT(new Date(agora.getTime() + 86_400_000));
    const igual = (x: typeof p) => x.ano === p.ano && x.mes === p.mes && x.dia === p.dia;
    return { iso, hora: p.hora, minuto: p.minuto, dia: DIAS[p.diaSemana], ehHoje: igual(hoje), ehAmanha: igual(am), data: p.dia };
  });
  let filtro = cands;
  const pega = (f: (c: (typeof cands)[number]) => boolean) => { const r = filtro.filter(f); if (r.length) filtro = r; return r.length > 0; };

  // posição ("o primeiro", "1", "segunda opção") — só quando a mensagem é curta
  const curta = t.split(/\s+/).length <= 4;
  if (curta && /^(o |a )?(1|primeir[oa]|1a|1o|opcao 1)\b/.test(t)) return cands[0].iso;
  if (curta && /^(o |a )?(2|segund[oa] opcao|segundo|2a|2o|opcao 2|o outro|a outra)\b/.test(t) && cands[1]) return cands[1].iso;

  let algum = false;
  // hora
  const hm = t.match(/\b(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?\b/);
  if (hm) {
    const h = Number(hm[1]); const m = hm[2] ? Number(hm[2]) : null;
    algum = pega((c) => (c.hora === h || c.hora === h + 12) && (m === null || c.minuto === m)) || algum;
  } else if (/meio ?dia|almoco|12/.test(t)) algum = pega((c) => c.hora === 12) || algum;
  else if (/(a )?noite|fim da tarde|final da tarde|18|seis e meia/.test(t)) algum = pega((c) => c.hora >= 17) || algum;
  // dia
  if (/\bhoje\b/.test(t)) algum = pega((c) => c.ehHoje) || algum;
  else if (/\bamanha\b/.test(t)) algum = pega((c) => c.ehAmanha) || algum;
  else {
    const d = DIAS.find((x) => new RegExp(`\\b${x}`).test(t));
    if (d) algum = pega((c) => c.dia === d) || algum;
  }
  // confirmação curta quando só há 1 opção
  if (!algum && cands.length === 1 && /^(sim|pode ser|fechado|ok|beleza|blz|combinado|perfeito|fica bom|bom|otimo|show)\b/.test(t)) return cands[0].iso;
  return algum && filtro.length === 1 ? filtro[0].iso : null;
}
