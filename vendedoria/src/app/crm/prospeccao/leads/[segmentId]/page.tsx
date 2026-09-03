"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Phone, Globe, MapPin, CheckCircle2, Send,
  Search, Sparkles, Brain, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";

interface Lead {
  id: string;
  nome: string | null;
  telefone: string | null;
  tipoTelefone: string | null;
  enderecoCompleto: string | null;
  website: string | null;
  status: string;
  score: number | null;
  ratingGoogle: number | null;
  numeroAvaliacoes: number | null;
  analiseIA: string | null;
}

interface Segment {
  id: string;
  nome: string;
  termoBusca: string;
  cidades: string[];
  organizationId: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  NOVO:            { label: "Novo",        color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  ENRIQUECIDO:     { label: "Enriquecido", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  PONTUADO:        { label: "Pontuado",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
  ANALISADO:       { label: "P/ revisão",  color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
  APROVADO:        { label: "Aprovado",    color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  ABORDADO:        { label: "Abordado",    color: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  RESPONDEU:       { label: "Respondeu",   color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300" },
  QUALIFICADO:     { label: "Qualificado", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
  REUNIAO_AGENDADA:{ label: "Reunião",     color: "bg-primary/10 text-primary" },
  DESCARTADO:      { label: "Descartado",  color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

export default function LeadsSegmentoPage() {
  const { segmentId } = useParams<{ segmentId: string }>();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [leads, setLeads]   = useState<Lead[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const pageSize = 50;
  const [loading, setLoading]         = useState(true);
  const [acaoLoading, setAcaoLoading] = useState<string | null>(null);
  const [feedback, setFeedback]       = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  const carregar = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prospeccao/leads/${segmentId}?page=${p}`);
      const data = await res.json() as { segment: Segment; leads: Lead[]; total: number; page: number };
      setSegment(data.segment ?? null);
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [segmentId, page]);

  useEffect(() => { void carregar(page); }, [carregar, page]);

  const rodarAcao = async (acao: "sourcing" | "enriquecer" | "analisar" | "aprovar") => {
    setAcaoLoading(acao);
    setFeedback(null);
    try {
      const url =
        acao === "sourcing"   ? `/api/prospeccao/sourcing/${segmentId}` :
        acao === "enriquecer" ? `/api/prospeccao/enriquecimento/lote/${segmentId}` :
        acao === "analisar"   ? `/api/prospeccao/analise/lote/${segmentId}` :
        `/api/prospeccao/aprovar-lote/${segmentId}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? res.status));
      const msg =
        acao === "sourcing"   ? `Busca: ${String(data.inseridos ?? 0)} novas empresas` :
        acao === "enriquecer" ? `Enriquecimento concluído` :
        acao === "analisar"   ? `Análise IA concluída` :
        `${String(data.aprovados ?? 0)} leads aprovados para disparo`;
      setFeedback({ tipo: "ok", msg });
      void carregar(1);
      setPage(1);
    } catch (e) {
      setFeedback({ tipo: "erro", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setAcaoLoading(null);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/crm/prospeccao" className="p-1.5 rounded-lg hover:bg-accent/10 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-foreground leading-tight">
              {segment?.nome ?? "Carregando..."}
            </h1>
            <p className="text-xs text-muted-foreground">
              {segment ? `"${segment.termoBusca}" · ${segment.cidades.join(", ")}` : ""}
              {total > 0 ? ` · ${total} empresas` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AcaoBtn icon={<Search className="w-3.5 h-3.5" />} label="Buscar mais"
            loading={acaoLoading === "sourcing"} disabled={!!acaoLoading}
            onClick={() => void rodarAcao("sourcing")} />
          <AcaoBtn icon={<Sparkles className="w-3.5 h-3.5" />} label="Enriquecer"
            loading={acaoLoading === "enriquecer"} disabled={!!acaoLoading}
            onClick={() => void rodarAcao("enriquecer")} />
          <AcaoBtn icon={<Brain className="w-3.5 h-3.5" />} label="Analisar IA"
            loading={acaoLoading === "analisar"} disabled={!!acaoLoading}
            onClick={() => void rodarAcao("analisar")} />
          <AcaoBtn icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Aprovar todos"
            loading={acaoLoading === "aprovar"} disabled={!!acaoLoading}
            variant="green"
            onClick={() => void rodarAcao("aprovar")} />
          <Link
            href="/crm/prospeccao/disparo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Send className="w-3.5 h-3.5" /> Ir para Disparo
          </Link>
        </div>
      </div>

      {feedback && (
        <div className={`mx-6 mt-4 text-sm rounded-lg px-4 py-3 border ${
          feedback.tipo === "ok"
            ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300"
            : "bg-red-50 border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300"
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* Lista de leads */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Search className="w-10 h-10 opacity-40" />
            <p className="text-sm">Nenhuma empresa encontrada neste segmento</p>
            <button
              onClick={() => void rodarAcao("sourcing")}
              disabled={!!acaoLoading}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              Buscar empresas agora
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {leads.map((lead) => {
                const st = STATUS_LABEL[lead.status] ?? { label: lead.status, color: "bg-muted text-muted-foreground" };
                return (
                  <div key={lead.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground leading-tight flex-1 min-w-0 truncate">
                        {lead.nome ?? "—"}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>
                        {st.label}
                      </span>
                    </div>

                    {lead.telefone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span>{lead.telefone}</span>
                        {lead.tipoTelefone === "CELULAR" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 font-medium">
                            WhatsApp
                          </span>
                        )}
                      </div>
                    )}

                    {lead.enderecoCompleto && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{lead.enderecoCompleto}</span>
                      </div>
                    )}

                    {lead.website && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Globe className="w-3 h-3 shrink-0" />
                        <a href={lead.website} target="_blank" rel="noopener noreferrer"
                          className="text-primary hover:underline truncate">
                          {lead.website.replace(/^https?:\/\//, "")}
                        </a>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t border-border/50 mt-auto">
                      {lead.ratingGoogle != null && (
                        <span>⭐ {lead.ratingGoogle.toFixed(1)}{lead.numeroAvaliacoes ? ` (${lead.numeroAvaliacoes})` : ""}</span>
                      )}
                      {lead.score != null && lead.score > 0 && (
                        <span className="ml-auto font-medium text-foreground">Score {lead.score}</span>
                      )}
                    </div>

                    {lead.analiseIA && (
                      <p className="text-[11px] text-muted-foreground italic line-clamp-2 border-t border-border/50 pt-1">
                        {lead.analiseIA}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6 text-sm text-muted-foreground">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded hover:bg-accent/10 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>Página {page} de {totalPages} ({total} empresas)</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded hover:bg-accent/10 disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AcaoBtn({ icon, label, loading, disabled, onClick, variant = "default" }: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "default" | "green";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
        variant === "green"
          ? "border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
          : "border-border hover:bg-accent/10"
      }`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
