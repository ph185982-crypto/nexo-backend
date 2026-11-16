// Eventos para a Central Avanteza: POST ${CENTRAL_URL}/api/eventos com Bearer AVANTEZA_EVENTS_KEY.
// Outbox local (CentralEventoOutbox): o evento é gravado antes do envio; eventoId é a chave de idempotência dos
// dois lados (gravar de novo o mesmo eventoId não duplica, e a Central ignora o repetido). Retentativa com espera
// crescente pela rota de cron (/api/cron/comercial) e por quem grava o evento (tentativa imediata).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";

export interface EventoCentral<P = Record<string, unknown>> {
  id: string;
  tipo: string;
  origem: "comercial";
  ocorrido_em: string;
  payload: P;
}

const ESPERA_MIN = [1, 5, 30, 120, 360, 720, 1440];
export const MAX_TENTATIVAS_CENTRAL = 10;
const TRAVA_MS = 2 * 60_000;
const TIMEOUT_MS = 8_000;
const espera = (t: number) => ESPERA_MIN[Math.min(t - 1, ESPERA_MIN.length - 1)] * 60_000;

/** Grava o evento (idempotente por id). Devolve false se já existia. */
export async function gravarEventoCentral(ev: EventoCentral): Promise<boolean> {
  const r = await prisma.centralEventoOutbox.createMany({
    data: [{ eventoId: ev.id, tipo: ev.tipo, payload: ev as unknown as Prisma.InputJsonValue }], skipDuplicates: true,
  });
  return r.count > 0;
}

async function enviar(corpo: unknown): Promise<{ ok: true } | { ok: false; definitivo: boolean; erro: string }> {
  const base = process.env.CENTRAL_URL?.trim().replace(/\/+$/, "");
  const chave = process.env.AVANTEZA_EVENTS_KEY?.trim();
  if (!base || !chave) return { ok: false, definitivo: false, erro: "CENTRAL_URL/AVANTEZA_EVENTS_KEY não configurados" };
  try {
    const r = await fetch(`${base}/api/eventos`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Contrato da Central (avanteza/docs/eventos.md): 202 recebido, 200 repetido (mesmo id). Retenta só 5xx, 429 e
    // falha de rede; 4xx (400 inválido, 401 chave errada, 415, 422 tipo desconhecido) é definitivo.
    if (r.ok) return { ok: true };
    const txt = (await r.text().catch(() => "")).slice(0, 200);
    return { ok: false, definitivo: r.status >= 400 && r.status < 500 && r.status !== 429, erro: `HTTP ${r.status} ${txt}`.trim() };
  } catch (e) {
    return { ok: false, definitivo: false, erro: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

/** Envia os eventos vencidos. Seguro em paralelo (cada linha é reivindicada antes do envio). */
export async function despacharEventosCentral(o: { limite?: number; agora?: Date; eventoId?: string } = {}) {
  const agora = o.agora ?? new Date();
  const res = { enviados: 0, falhas: 0, adiados: 0 };
  const devidos = await prisma.centralEventoOutbox.findMany({
    where: { status: "PENDENTE", proximaTentativaEm: { lte: agora }, ...(o.eventoId ? { eventoId: o.eventoId } : {}) },
    orderBy: { criadoEm: "asc" }, take: o.limite ?? 20,
  });
  for (const ev of devidos) {
    const claim = await prisma.centralEventoOutbox.updateMany({ where: { id: ev.id, status: "PENDENTE", proximaTentativaEm: ev.proximaTentativaEm }, data: { proximaTentativaEm: new Date(agora.getTime() + TRAVA_MS) } });
    if (claim.count === 0) continue;
    const r = await enviar(ev.payload);
    if (r.ok) {
      await prisma.centralEventoOutbox.update({ where: { id: ev.id }, data: { status: "ENVIADO", enviadoEm: new Date(), tentativas: { increment: 1 }, ultimoErro: null } });
      res.enviados++;
      continue;
    }
    const tentativas = ev.tentativas + 1;
    const desistir = r.definitivo || tentativas >= MAX_TENTATIVAS_CENTRAL;
    await prisma.centralEventoOutbox.update({
      where: { id: ev.id },
      data: { tentativas, ultimoErro: r.erro, status: desistir ? "FALHOU" : "PENDENTE", proximaTentativaEm: new Date(agora.getTime() + espera(tentativas)) },
    });
    if (desistir) res.falhas++; else res.adiados++;
    if (!desistir && /CENTRAL_URL/.test(r.erro)) break;
  }
  return res;
}
