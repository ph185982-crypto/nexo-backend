"use client";

// Entrega real das mensagens de prospecção (dados dos webhooks de status da Meta):
// enviadas × entregues × lidas × falhas, e o motivo de cada falha.

import React, { useEffect, useState } from "react";
import { Loader2, MailCheck, AlertTriangle } from "lucide-react";
import { api } from "./api";

interface Entrega {
  dias: number; total: number; entregues: number; lidos: number; falhas: number; semConfirmacao: number;
  taxaEntrega: number | null; taxaLeitura: number | null;
  erros: Array<{ codigo: number | null; quantidade: number; explicacao: string }>;
  porTemplate: Array<{ template: string; total: number; entregues: number; lidos: number; falhas: number }>;
  recebeuStatusAlgumaVez: boolean;
}

function Num({ rotulo, valor, tom }: { rotulo: string; valor: string | number; tom?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className={`text-lg font-semibold ${tom ?? "text-foreground"}`}>{valor}</p>
    </div>
  );
}

export function EntregaMensagens({ orgId, versao }: { orgId: string; versao: number }) {
  const [dias, setDias] = useState(7);
  const [d, setD] = useState<Entrega | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    api<Entrega>(`/api/prospeccao/disparo/entrega/${orgId}?dias=${dias}`)
      .then((r) => { if (vivo) setD(r); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [orgId, dias, versao]);

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MailCheck className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Entrega das mensagens</h3>
        <select
          value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período"
          className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value={1}>24 horas</option><option value={7}>7 dias</option><option value={30}>30 dias</option>
        </select>
      </div>

      {erro ? <p className="text-xs text-red-500">{erro}</p> : !d ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>
      ) : d.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum envio rastreado neste período. O rastreio vale para mensagens enviadas depois desta atualização —
          os envios anteriores não guardaram o identificador da Meta.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Num rotulo="Enviadas" valor={d.total} />
            <Num rotulo="Entregues" valor={`${d.entregues}${d.taxaEntrega != null ? ` (${d.taxaEntrega}%)` : ""}`} tom="text-green-600 dark:text-green-400" />
            <Num rotulo="Lidas" valor={`${d.lidos}${d.taxaLeitura != null ? ` (${d.taxaLeitura}%)` : ""}`} />
            <Num rotulo="Falharam" valor={d.falhas} tom={d.falhas ? "text-red-500" : undefined} />
            <Num rotulo="Sem confirmação" valor={d.semConfirmacao} tom={d.semConfirmacao ? "text-amber-500" : undefined} />
          </div>

          {!d.recebeuStatusAlgumaVez && (
            <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Nenhum status de entrega chegou da Meta. Confira no app da Meta (WhatsApp → Configuração → Webhook)
              se o campo <b>messages</b> está inscrito.
            </p>
          )}

          {d.erros.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Motivos de falha</p>
              {d.erros.map((e) => (
                <p key={String(e.codigo)} className="text-xs text-muted-foreground">
                  <b className="text-foreground">{e.quantidade}×</b> {e.codigo ? `[${e.codigo}] ` : ""}{e.explicacao}
                </p>
              ))}
            </div>
          )}

          {d.porTemplate.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Por template</p>
              {d.porTemplate.map((t) => (
                <p key={t.template} className="text-xs text-muted-foreground">
                  <b className="text-foreground">{t.template}</b> — {t.total} enviadas · {t.entregues} entregues · {t.lidos} lidas · {t.falhas} falhas
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
