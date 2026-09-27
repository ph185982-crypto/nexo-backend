"use client";

// Funil em etapas no topo do hub: mostra quantas empresas há em cada fase do
// fluxo e leva direto para onde elas são trabalhadas.

import React from "react";
import { Sparkles, ClipboardCheck, Send, MessagesSquare, CalendarCheck, ChevronRight } from "lucide-react";
import { ETAPAS } from "@/lib/prospeccao/status";
import { fmtNum, type Resumo } from "./api";
import type { AbaId, Navegar } from "./navegacao";

const ICONES = {
  qualificar: Sparkles,
  revisar: ClipboardCheck,
  abordar: Send,
  conversando: MessagesSquare,
  ganhos: CalendarCheck,
} as const;

const DESTINO: Record<(typeof ETAPAS)[number]["id"], { aba: AbaId; params?: Record<string, string> }> = {
  qualificar:  { aba: "buscas" },
  revisar:     { aba: "revisao" },
  abordar:     { aba: "disparo" },
  conversando: { aba: "empresas", params: { etapa: "conversando" } },
  ganhos:      { aba: "empresas", params: { etapa: "ganhos" } },
};

export function Stepper({ resumo, navegar }: { resumo: Resumo | null; navegar: Navegar }) {
  return (
    <div className="px-4 md:px-6 pb-3 overflow-x-auto scrollbar-none">
      <ol className="flex items-stretch gap-1 min-w-max md:min-w-0">
        {ETAPAS.map((e, i) => {
          const n = resumo?.etapas[e.id] ?? 0;
          const Icon = ICONES[e.id];
          const destaque = e.id === "revisar" && n > 0;
          return (
            <li key={e.id} className="flex items-center gap-1 md:flex-1">
              <button
                onClick={() => navegar(DESTINO[e.id].aba, DESTINO[e.id].params)}
                title={e.descricao}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left w-full transition-colors hover:border-primary/50 ${
                  destaque ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-background"
                }`}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  n > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold leading-none text-foreground">
                    {resumo ? fmtNum(n) : "–"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">{e.label}</span>
                </span>
              </button>
              {i < ETAPAS.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
