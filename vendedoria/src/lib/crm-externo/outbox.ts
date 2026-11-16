// Entrega do outbox: retentativa com espera crescente; erro de formato (400/inválido) não é refeito.
// Destino: o CRM antigo por HTTP ou, com COMERCIAL_NATIVO=1, o tratador em processo (ver eventos.ts).
import { prisma } from "@/lib/prisma/client";

const ESPERA_MIN = [1, 5, 30, 120, 360, 720, 1440];
export const MAX_TENTATIVAS = 8;
const TRAVA_MS = 2 * 60_000;
const TIMEOUT_MS = 8_000;

export const esperaAposTentativa = (tentativas: number) => ESPERA_MIN[Math.min(tentativas - 1, ESPERA_MIN.length - 1)] * 60_000;

type Envio = { ok: true } | { ok: false; definitivo: boolean; erro: string };

/** COMERCIAL_NATIVO=1: o mesmo contrato do CRM, tratado aqui (idempotente por eventoId; DUPLICADO conta como entregue). */
async function tratarEmProcesso(payload: unknown): Promise<Envio> {
  const { validarEvento, processarEventoVendedorIa } = await import("@/lib/comercial/integracao/eventos");
  const v = validarEvento(payload);
  if (!v.ok) return { ok: false, definitivo: true, erro: `inválido: ${v.erro}` }; // como o 400 do CRM
  try {
    await processarEventoVendedorIa(v.evento);
    return { ok: true };
  } catch (e) {
    return { ok: false, definitivo: false, erro: `nativo: ${String(e instanceof Error ? e.message : e)}`.slice(0, 200) };
  }
}

async function enviar(payload: unknown, timeoutMs: number): Promise<Envio> {
  if (process.env.COMERCIAL_NATIVO?.trim() === "1") return tratarEmProcesso(payload);
  const base = process.env.CRM_URL?.trim().replace(/\/+$/, "");
  const chave = process.env.CRM_API_KEY?.trim();
  if (!base || !chave) return { ok: false, definitivo: false, erro: "CRM_URL/CRM_API_KEY não configurados" };
  try {
    const r = await fetch(`${base}/api/integracoes/vendedor-ia/eventos`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return { ok: true };
    const corpo = (await r.text().catch(() => "")).slice(0, 200);
    // 400 = o CRM recusou o formato: reenviar o mesmo corpo nunca vai passar.
    return { ok: false, definitivo: r.status === 400, erro: `HTTP ${r.status} ${corpo}`.trim() };
  } catch (e) {
    return { ok: false, definitivo: false, erro: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

/** Envia os eventos vencidos. Seguro para chamar em paralelo (cada linha é reivindicada antes de enviar). */
export async function despacharOutboxCrm(
  o: { limite?: number; agora?: Date; /** para de começar envios depois deste tempo (quem chama tem prazo, ex.: health) */ orcamentoMs?: number; timeoutMs?: number } = {},
): Promise<{ enviados: number; falhas: number; adiados: number }> {
  const agora = o.agora ?? new Date();
  const inicio = Date.now();
  const res = { enviados: 0, falhas: 0, adiados: 0 };
  const devidos = await prisma.crmEventoOutbox.findMany({
    where: { status: "PENDENTE", proximaTentativaEm: { lte: agora } }, orderBy: { criadoEm: "asc" }, take: o.limite ?? 20,
  });
  for (const ev of devidos) {
    if (o.orcamentoMs !== undefined && Date.now() - inicio >= o.orcamentoMs) break; // o resto fica para a próxima rodada
    // Reivindica: só quem muda proximaTentativaEm a partir do valor lido envia.
    const claim = await prisma.crmEventoOutbox.updateMany({ where: { id: ev.id, status: "PENDENTE", proximaTentativaEm: ev.proximaTentativaEm }, data: { proximaTentativaEm: new Date(agora.getTime() + TRAVA_MS) } });
    if (claim.count === 0) continue;
    const r = await enviar(ev.payload, o.timeoutMs ?? TIMEOUT_MS);
    if (r.ok) {
      await prisma.crmEventoOutbox.update({ where: { id: ev.id }, data: { status: "ENVIADO", enviadoEm: new Date(), tentativas: { increment: 1 }, ultimoErro: null } });
      res.enviados++;
      continue;
    }
    const tentativas = ev.tentativas + 1;
    const desistir = r.definitivo || tentativas >= MAX_TENTATIVAS;
    await prisma.crmEventoOutbox.update({
      where: { id: ev.id },
      data: { tentativas, ultimoErro: r.erro, status: desistir ? "FALHOU" : "PENDENTE", proximaTentativaEm: new Date(agora.getTime() + esperaAposTentativa(tentativas)) },
    });
    if (desistir) res.falhas++; else res.adiados++;
    if (!desistir && /CRM_URL/.test(r.erro)) break; // sem configuração, não adianta insistir nos demais
  }
  return res;
}
