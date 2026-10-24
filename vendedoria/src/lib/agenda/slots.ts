// Horários para a ligação de diagnóstico — sempre no fuso de Brasília.
//
// O Brasil não tem horário de verão desde 2019: Brasília = UTC-3 fixo. Fazer a
// conta explícita evita o bug de usar getHours() do servidor (a Vercel roda em
// UTC, então "9h às 18h" virava 6h às 15h em Brasília).

const OFFSET_BRT_MS = -3 * 60 * 60 * 1000;

/** Horários (hora cheia, Brasília) em que a ligação pode começar. Configurável por env. */
export function horariosAgenda(env: Record<string, string | undefined> = process.env): number[] {
  const bruto = env.AGENDA_HORARIOS ?? "9,10,11,14,15,16,17";
  const horas = bruto.split(",").map((h) => Number(h.trim())).filter((h) => Number.isInteger(h) && h >= 6 && h <= 21);
  return horas.length ? Array.from(new Set(horas)).sort((a, b) => a - b) : [9, 10, 11, 14, 15, 16, 17];
}

export const DURACAO_REUNIAO_MIN = Number(process.env.AGENDA_DURACAO_MIN) || 30;
const ANTECEDENCIA_MIN = 90; // nunca oferece horário daqui a menos de 1h30
const DIAS_SEMANA_UTEIS = [1, 2, 3, 4, 5];

export interface PartesBRT { ano: number; mes: number; dia: number; hora: number; minuto: number; diaSemana: number }

export function partesBRT(d: Date): PartesBRT {
  const b = new Date(d.getTime() + OFFSET_BRT_MS);
  return {
    ano: b.getUTCFullYear(), mes: b.getUTCMonth() + 1, dia: b.getUTCDate(),
    hora: b.getUTCHours(), minuto: b.getUTCMinutes(), diaSemana: b.getUTCDay(),
  };
}

/** Constrói o instante (UTC) correspondente a uma data/hora de Brasília. */
export function deBRT(ano: number, mes: number, dia: number, hora: number, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, hora, minuto) - OFFSET_BRT_MS);
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "hoje às 15h", "amanhã (terça, 27/10) às 10h", "quarta (28/10) às 14h" — como o lead lê no WhatsApp. */
export function rotuloSlot(d: Date, agora: Date = new Date()): string {
  const p = partesBRT(d);
  const h = partesBRT(agora);
  const am = partesBRT(new Date(agora.getTime() + 86_400_000));
  const igual = (x: PartesBRT) => x.ano === p.ano && x.mes === p.mes && x.dia === p.dia;
  const data = `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
  const hora = p.minuto ? `${p.hora}h${String(p.minuto).padStart(2, "0")}` : `${p.hora}h`;
  if (igual(h)) return `hoje às ${hora}`;
  if (igual(am)) return `amanhã (${DIAS[p.diaSemana]}, ${data}) às ${hora}`;
  return `${DIAS[p.diaSemana]} (${data}) às ${hora}`;
}

export interface Slot { inicio: Date; fim: Date; label: string; iso: string }
export interface Intervalo { start: number; end: number }

/**
 * Próximos horários livres em dias úteis, espalhados por pelo menos 2 dias
 * (2 por dia) — dá escolha ao lead sem virar cardápio.
 */
export function gerarSlots(opts: {
  agora?: Date;
  ocupados?: Intervalo[];
  quantidade?: number;
  porDia?: number;
  horas?: number[];
  duracaoMin?: number;
  diasAFrente?: number;
} = {}): Slot[] {
  const agora = opts.agora ?? new Date();
  const ocupados = opts.ocupados ?? [];
  const quantidade = opts.quantidade ?? 4;
  const porDia = opts.porDia ?? 2;
  const horas = opts.horas ?? horariosAgenda();
  const duracao = (opts.duracaoMin ?? DURACAO_REUNIAO_MIN) * 60_000;
  const limiteInicio = agora.getTime() + ANTECEDENCIA_MIN * 60_000;
  const slots: Slot[] = [];

  for (let d = 0; d <= (opts.diasAFrente ?? 10) && slots.length < quantidade; d++) {
    const ref = partesBRT(new Date(agora.getTime() + d * 86_400_000));
    if (!DIAS_SEMANA_UTEIS.includes(ref.diaSemana)) continue;
    let noDia = 0;
    for (const hora of horas) {
      if (noDia >= porDia || slots.length >= quantidade) break;
      const inicio = deBRT(ref.ano, ref.mes, ref.dia, hora);
      if (inicio.getTime() < limiteInicio) continue;
      const fim = new Date(inicio.getTime() + duracao);
      if (ocupados.some((o) => inicio.getTime() < o.end && fim.getTime() > o.start)) continue;
      // Espalha no dia: manhã e tarde em vez de 9h e 10h
      if (noDia > 0 && slots.length && Math.abs(inicio.getTime() - slots[slots.length - 1].inicio.getTime()) < 3 * 3_600_000) continue;
      slots.push({ inicio, fim, label: rotuloSlot(inicio, agora), iso: inicio.toISOString() });
      noDia++;
    }
  }
  return slots;
}

/**
 * Um horário que o LLM devolveu é aceitável? Futuro (≥ 1h), em dia útil,
 * dentro do expediente configurado e até 14 dias à frente.
 */
export function horarioAceitavel(iso: string | null | undefined, agora: Date = new Date()): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() < agora.getTime() + 60 * 60_000) return null;
  if (d.getTime() > agora.getTime() + 14 * 86_400_000) return null;
  const p = partesBRT(d);
  if (!DIAS_SEMANA_UTEIS.includes(p.diaSemana)) return null;
  const horas = horariosAgenda();
  const ultima = Math.max(...horas);
  if (p.hora < Math.min(...horas) || p.hora > ultima) return null;
  return d;
}
