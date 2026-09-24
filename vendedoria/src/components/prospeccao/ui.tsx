"use client";

// Peças visuais pequenas reaproveitadas pelas abas da Prospecção.

import React, { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Loader2 } from "lucide-react";
import { infoStatus } from "@/lib/prospeccao/status";

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const i = infoStatus(status);
  return (
    <span className={`inline-flex items-center whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full ${i.cor} ${className}`}>
      {i.label}
    </span>
  );
}

export function Sinal({ value, label }: { value: boolean | null | undefined; label: string }) {
  const cor =
    value === true  ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30" :
    value === false ? "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30" :
    "text-muted-foreground bg-background border-border";
  const icone = value === true ? "✓" : value === false ? "✗" : "?";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${cor}`}>
      {icone} {label}
    </span>
  );
}

export function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const cor = score >= 5 ? "bg-green-500/15 text-green-700 dark:text-green-300"
    : score >= 3 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center justify-center min-w-7 text-xs font-bold px-1.5 py-0.5 rounded-md ${cor}`}>{score}</span>;
}

export function EmptyState({ icon, titulo, descricao, acao }: {
  icon: React.ReactNode;
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4 gap-3 text-muted-foreground">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center opacity-80">{icon}</div>
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {descricao && <p className="text-xs max-w-sm">{descricao}</p>}
      {acao}
    </div>
  );
}

export function Carregando({ texto = "Carregando..." }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> {texto}
    </div>
  );
}

export const btn = {
  primario: "inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity",
  secundario: "inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent/10 disabled:opacity-50 transition-colors",
  perigo: "inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors",
  sucesso: "inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors",
  fantasma: "inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/10 disabled:opacity-50 transition-colors",
};

export const inputCls = "w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary";

// ── Avisos (toasts) ────────────────────────────────────────────────────────────

type TipoAviso = "ok" | "erro" | "info";
interface Aviso { id: number; tipo: TipoAviso; msg: string }

const AvisoCtx = createContext<(msg: string, tipo?: TipoAviso) => void>(() => {});

export function useAviso() {
  return useContext(AvisoCtx);
}

export function AvisosProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const avisar = useCallback((msg: string, tipo: TipoAviso = "ok") => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a.slice(-3), { id, tipo, msg }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 8000 : 4500);
  }, []);

  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed z-[60] bottom-20 md:bottom-6 right-4 left-4 md:left-auto flex flex-col gap-2 md:w-96 pointer-events-none">
        {avisos.map((a) => (
          <div
            key={a.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg bg-card ${
              a.tipo === "erro" ? "border-red-500/40" : a.tipo === "ok" ? "border-green-500/40" : "border-border"
            }`}
          >
            {a.tipo === "erro"
              ? <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              : <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${a.tipo === "ok" ? "text-green-500" : "text-primary"}`} />}
            <span className="flex-1 text-foreground">{a.msg}</span>
            <button onClick={() => setAvisos((x) => x.filter((y) => y.id !== a.id))} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  );
}
