// Gancho chamado quando um lead muda de coluna. Agenda o envio do evento para
// depois da resposta (after) quando há contexto de requisição, para a chamada à
// Meta não atrasar webhook nem arrastar de cards; fora de requisição (scripts,
// testes) executa direto. Nunca lança.

import { after } from "next/server";
import { eventoDaColuna } from "@/lib/crm/funil-config";
import { enviarEventoMeta } from "@/lib/meta-capi";

export async function aoLeadMudarDeColunaAgendado(
  leadId: string,
  coluna: { type: string; name: string },
): Promise<void> {
  const evento = eventoDaColuna(coluna);
  if (!evento) return;
  try {
    after(() => enviarEventoMeta(leadId, evento).then(() => undefined));
  } catch {
    // sem contexto de requisição → envia aqui mesmo
    await enviarEventoMeta(leadId, evento).catch(() => undefined);
  }
}
