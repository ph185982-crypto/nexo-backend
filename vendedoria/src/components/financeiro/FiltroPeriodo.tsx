"use client";

// Filtro de competência compartilhado (Visão Geral e Receitas):
// Mês (padrão, com navegação ‹ ›), Dia, Período livre e — quando permitido — Tudo;
// mais o escopo Nexo × Pessoal.

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { mesAtualBR, somarMesesStr } from "./receitas-shared";

export type ModoFiltro = "mes" | "dia" | "intervalo" | "todos";
export type EscopoFiltro = "todos" | "nexo" | "pessoal";

export interface FiltroFin {
  modo: ModoFiltro;
  mes: string;
  dia: string;
  de: string;
  ate: string;
  escopo: EscopoFiltro;
}

export function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function filtroInicial(): FiltroFin {
  const hoje = hojeBR();
  return { modo: "mes", mes: mesAtualBR(), dia: hoje, de: hoje, ate: hoje, escopo: "todos" };
}

export function filtroParaQuery(f: FiltroFin): URLSearchParams {
  const q = new URLSearchParams();
  if (f.modo === "mes") q.set("mes", f.mes);
  else if (f.modo === "dia") q.set("dia", f.dia);
  else if (f.modo === "intervalo") { q.set("de", f.de); q.set("ate", f.ate); }
  if (f.escopo !== "todos") q.set("escopo", f.escopo);
  return q;
}

function somarDiasStr(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function Seg<T extends string>({
  valor, opcoes, onChange, ariaLabel,
}: {
  valor: T;
  opcoes: Array<{ v: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={valor === o.v}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            valor === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const inputCls =
  "h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary";
const navBtn =
  "h-8 w-8 inline-flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";

export function FiltroPeriodo({
  filtro, onChange, permitirTodos = false, comEscopo = true,
}: {
  filtro: FiltroFin;
  onChange: (f: FiltroFin) => void;
  permitirTodos?: boolean;
  comEscopo?: boolean;
}) {
  const set = (p: Partial<FiltroFin>) => onChange({ ...filtro, ...p });
  const atual = mesAtualBR();
  const hoje = hojeBR();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Seg
        ariaLabel="Tipo de período"
        valor={filtro.modo}
        onChange={(modo) => set({ modo })}
        opcoes={[
          { v: "mes", label: "Mês" },
          { v: "dia", label: "Dia" },
          { v: "intervalo", label: "Período" },
          ...(permitirTodos ? [{ v: "todos" as ModoFiltro, label: "Tudo" }] : []),
        ]}
      />

      {filtro.modo === "mes" && (
        <div className="flex items-center gap-1.5">
          <button type="button" className={navBtn} aria-label="Mês anterior" onClick={() => set({ mes: somarMesesStr(filtro.mes, -1) })}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input type="month" className={inputCls} value={filtro.mes} onChange={(e) => e.target.value && set({ mes: e.target.value })} aria-label="Mês" />
          <button type="button" className={navBtn} aria-label="Próximo mês" onClick={() => set({ mes: somarMesesStr(filtro.mes, 1) })}>
            <ChevronRight className="w-4 h-4" />
          </button>
          {filtro.mes !== atual && (
            <button type="button" className="text-xs text-primary hover:underline ml-1" onClick={() => set({ mes: atual })}>
              Mês atual
            </button>
          )}
        </div>
      )}

      {filtro.modo === "dia" && (
        <div className="flex items-center gap-1.5">
          <button type="button" className={navBtn} aria-label="Dia anterior" onClick={() => set({ dia: somarDiasStr(filtro.dia, -1) })}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input type="date" className={inputCls} value={filtro.dia} onChange={(e) => e.target.value && set({ dia: e.target.value })} aria-label="Dia" />
          <button type="button" className={navBtn} aria-label="Próximo dia" onClick={() => set({ dia: somarDiasStr(filtro.dia, 1) })}>
            <ChevronRight className="w-4 h-4" />
          </button>
          {filtro.dia !== hoje && (
            <button type="button" className="text-xs text-primary hover:underline ml-1" onClick={() => set({ dia: hoje })}>
              Hoje
            </button>
          )}
        </div>
      )}

      {filtro.modo === "intervalo" && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="date" className={inputCls} value={filtro.de} onChange={(e) => e.target.value && set({ de: e.target.value })} aria-label="De" />
          <span>até</span>
          <input type="date" className={inputCls} value={filtro.ate} onChange={(e) => e.target.value && set({ ate: e.target.value })} aria-label="Até" />
        </div>
      )}

      {comEscopo && (
        <Seg
          ariaLabel="Negócio"
          valor={filtro.escopo}
          onChange={(escopo) => set({ escopo })}
          opcoes={[
            { v: "todos", label: "Tudo" },
            { v: "nexo", label: "Nexo" },
            { v: "pessoal", label: "Pessoal" },
          ]}
        />
      )}
    </div>
  );
}
