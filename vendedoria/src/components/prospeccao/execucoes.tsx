"use client";

// Execuções longas disparadas pela UI (buscar empresas e qualificar com IA).
// Ficam num contexto para que o progresso apareça tanto na Visão geral quanto
// nas Buscas, e para impedir duas execuções simultâneas na mesma busca.

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { api, type ResultadoPipeline } from "./api";
import { useAviso } from "./ui";

export type TipoExecucao = "sourcing" | "pipeline";

export interface Progresso {
  tipo: TipoExecucao;
  feito: number;
  total: number;
  texto: string;
}

interface Ctx {
  progresso: Record<string, Progresso>;
  executar: (segmentId: string, tipo: TipoExecucao, nome?: string) => Promise<void>;
}

const ExecCtx = createContext<Ctx>({ progresso: {}, executar: async () => {} });

export function useExecucoes() {
  return useContext(ExecCtx);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ExecucoesProvider({ children, onConcluido }: { children: React.ReactNode; onConcluido: () => void }) {
  const [progresso, setProgresso] = useState<Record<string, Progresso>>({});
  const rodando = useRef(new Set<string>());
  const avisar = useAviso();

  const atualizar = useCallback((id: string, p: Progresso | null) => {
    setProgresso((prev) => {
      const n = { ...prev };
      if (p) n[id] = p; else delete n[id];
      return n;
    });
  }, []);

  const qualificar = useCallback(async (segmentId: string, nome: string) => {
    const { restantes } = await api<{ restantes: ResultadoPipeline["restantes"] }>(`/api/prospeccao/pipeline/${segmentId}`);
    const total = restantes.total;
    if (total === 0) {
      avisar(`Nenhuma empresa pendente de qualificação em "${nome}".`, "info");
      return;
    }
    const soma = { aprovados: 0, revisao: 0, descartados: 0, erros: 0 };
    let feito = 0;
    atualizar(segmentId, { tipo: "pipeline", feito: 0, total, texto: `Qualificando 0 de ${total}…` });
    for (;;) {
      const r = await api<ResultadoPipeline>(`/api/prospeccao/pipeline/${segmentId}`, { method: "POST" });
      feito += r.processados;
      soma.aprovados += r.aprovados; soma.revisao += r.revisao; soma.descartados += r.descartados; soma.erros += r.erros;
      const tot = Math.max(total, feito + r.restantes.total);
      atualizar(segmentId, { tipo: "pipeline", feito, total: tot, texto: `Qualificando ${feito} de ${tot}…` });
      onConcluido();
      // Para quando acabou ou quando a passada não avançou nada (só erros).
      if (r.restantes.total === 0 || r.processados === 0) break;
    }
    avisar(
      `"${nome}" qualificada: ${soma.aprovados} aprovadas, ${soma.revisao} para revisar, ${soma.descartados} descartadas` +
        (soma.erros ? ` (${soma.erros} com erro — tente de novo mais tarde)` : "."),
      soma.erros && !soma.aprovados && !soma.revisao ? "erro" : "ok",
    );
  }, [atualizar, avisar, onConcluido]);

  const buscar = useCallback(async (segmentId: string, nome: string) => {
    atualizar(segmentId, { tipo: "sourcing", feito: 0, total: 0, texto: "Iniciando busca…" });
    const res = await fetch(`/api/prospeccao/sourcing/${segmentId}`, { method: "POST" });
    const data = await res.json().catch(() => ({})) as { status?: string; error?: string; inseridos?: number; ignorados?: number };
    if (!res.ok && res.status !== 202 && res.status !== 409) throw new Error(data.error ?? `Erro ${res.status}`);

    if (res.ok && data.status === "concluido") {
      avisar(`Busca concluída: ${data.inseridos ?? 0} novas empresas, ${data.ignorados ?? 0} já existiam.`);
      return;
    }
    // Em andamento (202) ou já rodando (409): acompanha pelo GET.
    for (;;) {
      await esperar(6000);
      const st = await api<{
        emAndamento: { inseridos: number; meta: number } | null;
        ultimoResultado: { status: string; motivo: string | null; resultado: { inseridos: number; ignorados: number } } | null;
      }>(`/api/prospeccao/sourcing/${segmentId}`);
      if (st.emAndamento) {
        atualizar(segmentId, {
          tipo: "sourcing",
          feito: st.emAndamento.inseridos,
          total: st.emAndamento.meta,
          texto: `Buscando… ${st.emAndamento.inseridos} de ${st.emAndamento.meta} empresas`,
        });
        onConcluido();
        continue;
      }
      const u = st.ultimoResultado;
      if (u?.status === "ERRO") avisar(`Busca "${nome}" interrompida: ${u.motivo ?? "erro desconhecido"}`, "erro");
      else avisar(`Busca "${nome}" concluída: ${u?.resultado.inseridos ?? 0} novas empresas, ${u?.resultado.ignorados ?? 0} já existiam.`);
      return;
    }
  }, [atualizar, avisar, onConcluido]);

  const executar = useCallback(async (segmentId: string, tipo: TipoExecucao, nome = "busca") => {
    if (rodando.current.has(segmentId)) {
      avisar("Já existe uma execução em andamento para esta busca.", "info");
      return;
    }
    rodando.current.add(segmentId);
    try {
      if (tipo === "pipeline") await qualificar(segmentId, nome);
      else await buscar(segmentId, nome);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      rodando.current.delete(segmentId);
      atualizar(segmentId, null);
      onConcluido();
    }
  }, [atualizar, avisar, buscar, onConcluido, qualificar]);

  return <ExecCtx.Provider value={{ progresso, executar }}>{children}</ExecCtx.Provider>;
}
