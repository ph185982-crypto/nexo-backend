"use client";

// Checklist de prontidão do disparo — mostra, item a item, o que bloqueia o envio.

import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { api } from "./api";

interface Diagnostico {
  prontoParaDisparar: boolean;
  checks: Array<{ item: string; ok: boolean; detalhe: string }>;
}

const ROTULOS: Record<string, string> = {
  pausa_manual: "Disparo não está pausado",
  janela_comercial: "Dentro da janela de envio",
  provider_whatsapp: "Número de WhatsApp conectado",
  access_token: "Token de acesso da Meta",
  saude_numero: "Número saudável",
  template_ativo: "Template de mensagem ativo",
  leads_elegiveis: "Empresas prontas para abordar",
};

export function ChecklistDisparo({ orgId, versao }: { orgId: string; versao: number }) {
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api<Diagnostico>(`/api/prospeccao/disparo/diagnostico/${orgId}`)
      .then((d) => { if (vivo) { setDiag(d); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [orgId, versao]);

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Pronto para disparar?</h3>
        {diag && (
          <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            diag.prontoParaDisparar ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          }`}>
            {diag.prontoParaDisparar ? "Tudo certo" : `${diag.checks.filter((c) => !c.ok).length} pendência(s)`}
          </span>
        )}
      </div>
      {erro ? (
        <p className="text-xs text-red-500">{erro}</p>
      ) : !diag ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando…</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {diag.checks.map((c) => (
            <li key={c.item} className="flex items-start gap-2 text-xs">
              {c.ok
                ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
              <div className="min-w-0">
                <p className="font-medium text-foreground">{ROTULOS[c.item] ?? c.item}</p>
                {!c.ok && <p className="text-muted-foreground break-words">{c.detalhe}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
