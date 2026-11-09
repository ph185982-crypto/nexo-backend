// Reuniões do Google Meet → agente de combinados.
//
// Sincronizar uma conta:
//  1. lista as reuniões (conferenceRecords) que terminaram desde a última sincronização (no 1º uso, 7 dias);
//  2. pega a transcrição pronta (FILE_GENERATED) e as falas; sem transcrição até 24 h depois do fim, desiste;
//  3. acha o evento da Agenda pelo código da sala e, pelos e-mails dos convidados, o contato e a oportunidade;
//  4. vinculada: a transcrição vira análise do agente (fonte REUNIAO) e um registro na linha do tempo.
//     Sem cliente identificado: fica na lista para a pessoa vincular (Configuração → Google).
// Idempotente: a mesma reunião nunca é processada duas vezes (conferenceRecord único).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarFeedback } from "@/lib/atividades/feedback";
import { registrarFonte } from "@/lib/combinados/fontes";
import { oportunidadeDoContato } from "@/lib/conversas/importar";
import { ErroGoogle, cifrar, decifrar, getGoogle, listarTudo, renovarToken } from "./cliente";

const MEET = "https://meet.googleapis.com/v2";
const AGENDA = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const HORA = 3_600_000;
const PRIMEIRA_JANELA_DIAS = 7;
const ESPERA_TRANSCRICAO_HORAS = 24;
export const INTERVALO_MINIMO_MIN = 10; // sincronização automática (ao abrir a ficha) no máximo a cada 10 min

interface ConferenceRecord { name: string; startTime: string; endTime?: string; space?: string }
interface Transcript { name: string; state: string }
interface Entrada { participant: string; text: string; startTime: string }
interface Participante { name: string; signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } }
interface Evento { summary?: string; hangoutLink?: string; conferenceData?: { conferenceId?: string }; attendees?: Array<{ email?: string; self?: boolean; resource?: boolean }> }

type Conta = NonNullable<Awaited<ReturnType<typeof prisma.contaGoogle.findUnique>>>;

/** Access token válido (renova se faltar menos de 1 min). Acesso revogado desativa a conta. */
export async function tokenDaConta(conta: Conta, agora: Date = new Date()): Promise<string> {
  if (conta.accessToken && conta.accessExpiraEm && conta.accessExpiraEm.getTime() - agora.getTime() > 60_000) return conta.accessToken;
  try {
    const t = await renovarToken(decifrar(conta.refreshTokenCifrado));
    await prisma.contaGoogle.update({
      where: { id: conta.id },
      data: { accessToken: t.access_token, accessExpiraEm: new Date(agora.getTime() + t.expires_in * 1000), ...(t.refresh_token && { refreshTokenCifrado: cifrar(t.refresh_token) }), erro: null },
    });
    return t.access_token;
  } catch (e) {
    if (e instanceof ErroGoogle && e.reconectar) await prisma.contaGoogle.update({ where: { id: conta.id }, data: { ativa: false, erro: "O Google revogou o acesso. Conecte de novo em Configuração → Google." } });
    throw e;
  }
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const nomeDe = (p: Participante) => p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? "Participante";

/** Evento da Agenda da reunião: mesmo código de sala, perto do horário. */
async function eventoDaReuniao(token: string, inicio: Date, fim: Date, codigo: string | null): Promise<Evento | null> {
  if (!codigo) return null;
  const u = new URL(AGENDA);
  u.searchParams.set("timeMin", new Date(inicio.getTime() - 2 * HORA).toISOString());
  u.searchParams.set("timeMax", new Date(fim.getTime() + 2 * HORA).toISOString());
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("maxResults", "50");
  const eventos = (await getGoogle<{ items?: Evento[] }>(u.toString(), token)).items ?? [];
  return eventos.find((e) => e.conferenceData?.conferenceId === codigo || (e.hangoutLink ?? "").endsWith(`/${codigo}`)) ?? null;
}

/** Oportunidade do cliente pelos e-mails dos convidados (o primeiro que for contato do CRM). */
async function oportunidadePorEmails(emails: string[]) {
  for (const email of emails) {
    const contato = await prisma.contato.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: [{ tipo: "desc" }, { criadoEm: "asc" }], select: { id: true } });
    if (!contato) continue;
    const op = await oportunidadeDoContato(contato.id);
    if (op) return op;
  }
  return null;
}

function textoParaAgente(r: { titulo: string | null; inicio: Date; fim: Date | null; transcricao: string }) {
  const quando = r.inicio.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return `Reunião no Google Meet${r.titulo ? `: ${r.titulo}` : ""} (${quando}).\n\n${r.transcricao}`;
}

/** Liga a reunião à oportunidade: transcrição para o agente e registro na linha do tempo. Idempotente. */
export async function vincularReuniao(reuniaoId: string, oportunidadeId: string): Promise<void> {
  const r = await prisma.reuniaoGoogle.findUnique({ where: { id: reuniaoId } });
  if (!r) throw new Error("Reunião não encontrada");
  if (!r.transcricao) throw new Error("Reunião sem transcrição");
  if (!(await prisma.oportunidade.findUnique({ where: { id: oportunidadeId }, select: { id: true } }))) throw new Error("Oportunidade não encontrada");
  const a = await registrarFonte({ oportunidadeId, fonte: "REUNIAO", fonteRef: r.conferenceRecord, texto: textoParaAgente({ ...r, transcricao: r.transcricao }) });
  const claim = await prisma.reuniaoGoogle.updateMany({ where: { id: r.id, status: { not: "VINCULADA" } }, data: { status: "VINCULADA", oportunidadeId, analiseId: a?.id ?? null } });
  if (claim.count === 0) return; // outra chamada já vinculou
  const minutos = r.fim ? Math.max(1, Math.round((r.fim.getTime() - r.inicio.getTime()) / 60_000)) : null;
  const falas = r.transcricao.split("\n").filter(Boolean).length;
  await registrarFeedback({ oportunidadeId, tipo: "REUNIAO", texto: `Reunião no Google Meet${r.titulo ? `: ${r.titulo}` : ""}${minutos ? ` (${minutos} min` : " ("}${minutos ? ", " : ""}${falas} falas transcritas). O agente vai ler a transcrição e sugerir os combinados.`, autor: "google-meet", autorNome: "Google Meet" });
  await prisma.oportunidade.update({ where: { id: oportunidadeId }, data: { ultimaAtividadeEm: new Date() } });
}

export interface ResultadoSincronizacao { reunioes: number; vinculadas: number; semCliente: number; aguardando: number; semTranscricao: number }

export async function sincronizarConta(contaId: string, agora: Date = new Date()): Promise<ResultadoSincronizacao> {
  const conta = await prisma.contaGoogle.findUnique({ where: { id: contaId } });
  if (!conta || !conta.ativa) throw new Error("Conta Google desconectada");
  const res: ResultadoSincronizacao = { reunioes: 0, vinculadas: 0, semCliente: 0, aguardando: 0, semTranscricao: 0 };
  try {
    const token = await tokenDaConta(conta, agora);
    // Volta um pouco além da última sincronização: transcrição pode ficar pronta depois do fim da reunião.
    const desde = conta.ultimaSincronizacaoEm
      ? new Date(Math.min(conta.ultimaSincronizacaoEm.getTime() - (ESPERA_TRANSCRICAO_HORAS + 2) * HORA, agora.getTime() - HORA))
      : new Date(agora.getTime() - PRIMEIRA_JANELA_DIAS * 24 * HORA);
    const u = new URL(`${MEET}/conferenceRecords`);
    u.searchParams.set("pageSize", "100");
    u.searchParams.set("filter", `end_time>="${desde.toISOString()}"`);
    const registros = await listarTudo<ConferenceRecord>(u.toString(), "conferenceRecords", token, 5);

    for (const reg of registros) {
      if (!reg.endTime) continue; // ainda acontecendo
      const ja = await prisma.reuniaoGoogle.findUnique({ where: { conferenceRecord: reg.name }, select: { status: true } });
      if (ja && ja.status !== "AGUARDANDO") continue;
      res.reunioes++;
      const inicio = new Date(reg.startTime), fim = new Date(reg.endTime);
      const transcricoes = await listarTudo<Transcript>(`${MEET}/${reg.name}/transcripts?pageSize=100`, "transcripts", token, 2);
      const prontas = transcricoes.filter((t) => t.state === "FILE_GENERATED");
      if (prontas.length === 0) {
        const desistir = agora.getTime() - fim.getTime() > ESPERA_TRANSCRICAO_HORAS * HORA;
        // Nenhuma transcrição 2 h depois do fim: a transcrição não foi ligada nessa reunião.
        const status = desistir || (transcricoes.length === 0 && agora.getTime() - fim.getTime() > 2 * HORA) ? "SEM_TRANSCRICAO" : "AGUARDANDO";
        await prisma.reuniaoGoogle.upsert({ where: { conferenceRecord: reg.name }, create: { contaId: conta.id, conferenceRecord: reg.name, inicio, fim, status, emails: [] }, update: { status } });
        if (status === "AGUARDANDO") res.aguardando++; else res.semTranscricao++;
        continue;
      }
      const participantes = await listarTudo<Participante>(`${MEET}/${reg.name}/participants?pageSize=100`, "participants", token, 3);
      const nomes = new Map(participantes.map((p) => [p.name, nomeDe(p)]));
      const linhas: string[] = [];
      for (const t of prontas) {
        const entradas = await listarTudo<Entrada>(`${MEET}/${t.name}/entries?pageSize=100`, "transcriptEntries", token, 60);
        for (const e of entradas) if (e.text?.trim()) linhas.push(`[${hhmm(e.startTime)}] ${nomes.get(e.participant) ?? "Participante"}: ${e.text.trim()}`);
      }
      const espaco = reg.space ? await getGoogle<{ meetingCode?: string }>(`${MEET}/${reg.space}`, token).catch(() => null) : null;
      const codigo = espaco?.meetingCode ?? null;
      const evento = await eventoDaReuniao(token, inicio, fim, codigo);
      const emails = (evento?.attendees ?? []).filter((x) => !x.self && !x.resource && x.email).map((x) => x.email!.toLowerCase());
      const dados = {
        titulo: evento?.summary ?? null, inicio, fim, meetingCode: codigo, emails,
        participantes: [...new Set(nomes.values())] as unknown as Prisma.InputJsonValue, transcricao: linhas.join("\n") || null,
      };
      if (!dados.transcricao) {
        await prisma.reuniaoGoogle.upsert({ where: { conferenceRecord: reg.name }, create: { contaId: conta.id, conferenceRecord: reg.name, ...dados, status: "SEM_TRANSCRICAO" }, update: { ...dados, status: "SEM_TRANSCRICAO" } });
        res.semTranscricao++;
        continue;
      }
      const op = await oportunidadePorEmails(emails);
      const r = await prisma.reuniaoGoogle.upsert({ where: { conferenceRecord: reg.name }, create: { contaId: conta.id, conferenceRecord: reg.name, ...dados, status: "SEM_CLIENTE" }, update: { ...dados, status: "SEM_CLIENTE" } });
      if (op) { await vincularReuniao(r.id, op.id); res.vinculadas++; } else res.semCliente++;
    }
    await prisma.contaGoogle.update({ where: { id: conta.id }, data: { ultimaSincronizacaoEm: agora, erro: null } });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const dica = e instanceof ErroGoogle && e.status === 403 ? " Confira se a Google Meet REST API e a Google Calendar API estão ativadas no projeto do Google Cloud." : "";
    await prisma.contaGoogle.update({ where: { id: conta.id }, data: { erro: `${msg}${dica}`.slice(0, 500) } }).catch(() => {});
    throw e;
  }
}

/** Cron: todas as contas ativas. Uma conta com erro não impede as outras. */
export async function sincronizarTodas(agora: Date = new Date()) {
  const contas = await prisma.contaGoogle.findMany({ where: { ativa: true }, select: { id: true } });
  const out = { contas: contas.length, vinculadas: 0, erros: 0 };
  for (const c of contas) {
    try { out.vinculadas += (await sincronizarConta(c.id, agora)).vinculadas; } catch { out.erros++; }
  }
  return out;
}

/** Ao abrir a ficha: sincroniza a conta do usuário se a última foi há mais de 10 min. Nunca lança. */
export async function sincronizarSeVencida(usuarioId: string, agora: Date = new Date()): Promise<void> {
  const conta = await prisma.contaGoogle.findUnique({ where: { usuarioId }, select: { id: true, ativa: true, ultimaSincronizacaoEm: true } });
  if (!conta?.ativa) return;
  if (conta.ultimaSincronizacaoEm && agora.getTime() - conta.ultimaSincronizacaoEm.getTime() < INTERVALO_MINIMO_MIN * 60_000) return;
  // Duas fichas abertas ao mesmo tempo podem sincronizar juntas: é seguro (reunião única, vínculo reivindicado).
  await sincronizarConta(conta.id, agora).catch(() => {});
}
