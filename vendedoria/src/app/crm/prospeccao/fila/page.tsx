"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, XCircle, Globe, Megaphone, Instagram,
  Star, Phone, MapPin, RefreshCw, ChevronRight, ChevronLeft,
} from "lucide-react";

interface ProspectLead {
  id: string;
  nome: string | null;
  telefone: string | null;
  tipoTelefone: string | null;
  enderecoCompleto: string | null;
  website: string | null;
  ratingGoogle: number | null;
  numeroAvaliacoes: number | null;
  temSite: boolean | null;
  temAnuncioAtivo: boolean | null;
  instagramAtivo: boolean | null;
  followersIG: number | null;
  score: number | null;
  analiseIA: string | null;
  motivoAnaliseIA: string | null;
  status: string;
  segment: { nome: string; termoBusca: string } | null;
  createdAt: string;
}

interface FilaResponse {
  leads: ProspectLead[];
  total: number;
  page: number;
  pageSize: number;
}

type TabType = "ANALISADO" | "APROVADO";

const STATUS_LABEL: Record<string, string> = {
  NOVO:              "Novo",
  ENRIQUECIDO:       "Enriquecido",
  PONTUADO:          "Pontuado",
  ANALISADO:         "Aguardando revisão",
  APROVADO:          "Aprovado",
  DESCARTADO:        "Descartado",
  ABORDADO:          "Abordado",
  RESPONDEU:         "Respondeu",
  QUALIFICADO:       "Qualificado",
  REUNIAO_AGENDADA:  "Reunião agendada",
  PERDIDO:           "Perdido",
};

function Sinal({
  value,
  label,
}: {
  value: boolean | null | undefined;
  label: string;
}) {
  const cor =
    value === true  ? "text-green-600 bg-green-50 border-green-200" :
    value === false ? "text-red-600 bg-red-50 border-red-200" :
    "text-muted-foreground bg-background border-border";
  const icon = value === true ? "✓" : value === false ? "✗" : "—";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cor}`}>
      {icon} {label}
    </span>
  );
}

export default function FilaProspeccaoPage() {
  const [tab, setTab] = useState<TabType>("ANALISADO");
  const [leads, setLeads] = useState<ProspectLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prospeccao/fila?status=${tab}&page=${page}`);
      const data = await res.json() as FilaResponse;
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const agir = async (leadId: string, action: "aprovar" | "descartar") => {
    setActionLoading(leadId);
    try {
      await fetch(`/api/prospeccao/fila/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      setTotal((t) => t - 1);
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  const pageSize = 30;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Fila de Qualificação</h1>
          <p className="text-sm text-muted-foreground">Nexos Brasil — Prospecção B2B</p>
        </div>
        <button
          onClick={() => void carregar()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border hover:bg-background disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-card px-6">
        {(["ANALISADO", "APROVADO"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            {t === "ANALISADO" ? "Aguardando revisão" : "Aprovados (spot-check)"}
            {tab === t && total > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                {total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4 bg-background">
        {loading && leads.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Carregando...
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <CheckCircle className="w-10 h-10 text-green-300" />
            <p className="text-sm">Nenhum lead nesta fila</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                tab={tab}
                onAprovar={() => void agir(lead.id, "aprovar")}
                onDescartar={() => void agir(lead.id, "descartar")}
                isLoading={actionLoading === lead.id}
              />
            ))}
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded border hover:bg-accent/10 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded border hover:bg-accent/10 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  tab,
  onAprovar,
  onDescartar,
  isLoading,
}: {
  lead: ProspectLead;
  tab: TabType;
  onAprovar: () => void;
  onDescartar: () => void;
  isLoading: boolean;
}) {
  const analiseColor =
    lead.analiseIA === "APROVAR_AUTO" ? "text-green-700 bg-green-50" :
    lead.analiseIA === "REVISAR"      ? "text-amber-700 bg-amber-50" :
    lead.analiseIA === "DESCARTAR"    ? "text-red-700 bg-red-50" :
    "text-muted-foreground bg-background";

  return (
    <div className="bg-card rounded-xl border shadow-sm p-4 flex flex-col gap-3">
      {/* Linha 1: nome + score + segmento */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-foreground text-sm leading-tight">
            {lead.nome ?? "Nome não informado"}
          </h3>
          {lead.segment && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Segmento: {lead.segment.nome} · {lead.segment.termoBusca}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lead.score !== null && (
            <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-blue-50 text-blue-700">
              Score {lead.score}
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded-lg font-medium ${analiseColor}`}>
            {lead.analiseIA ?? "—"}
          </span>
        </div>
      </div>

      {/* Linha 2: dados de contato */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {lead.telefone && (
          <span className="flex items-center gap-1">
            <Phone className="w-3 h-3" /> {lead.telefone}
            {lead.tipoTelefone && (
              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                lead.tipoTelefone === "CELULAR"
                  ? "bg-green-500/10 text-green-500"
                  : "bg-amber-500/10 text-amber-500"
              }`}>
                {lead.tipoTelefone === "CELULAR" ? "📱 WhatsApp" : "☎ Fixo"}
              </span>
            )}
          </span>
        )}
        {lead.enderecoCompleto && (
          <span className="flex items-center gap-1 max-w-xs truncate">
            <MapPin className="w-3 h-3 shrink-0" /> {lead.enderecoCompleto}
          </span>
        )}
        {lead.ratingGoogle !== null && (
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
            {lead.ratingGoogle.toFixed(1)} ({lead.numeroAvaliacoes} aval.)
          </span>
        )}
      </div>

      {/* Linha 3: sinais digitais */}
      <div className="flex flex-wrap gap-2">
        <Sinal value={lead.temSite}         label="Site" />
        <Sinal value={lead.temAnuncioAtivo} label="Anúncio" />
        <Sinal value={lead.instagramAtivo}  label="Instagram" />
        {lead.followersIG !== null && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-background text-xs text-muted-foreground">
            <Instagram className="w-3 h-3" />
            {lead.followersIG.toLocaleString("pt-BR")} seguidores
          </span>
        )}
        {lead.website && (
          <a
            href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-xs text-blue-700 hover:underline"
          >
            <Globe className="w-3 h-3" />
            Ver site
          </a>
        )}
      </div>

      {/* Motivo da IA */}
      {lead.motivoAnaliseIA && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
          IA: {lead.motivoAnaliseIA}
        </p>
      )}

      {/* Ações */}
      {tab === "ANALISADO" && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onAprovar}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Aprovar
          </button>
          <button
            onClick={onDescartar}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Descartar
          </button>
        </div>
      )}

      {tab === "APROVADO" && (
        <div className="flex justify-end">
          <button
            onClick={onDescartar}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Descartar (revisão)
          </button>
        </div>
      )}
    </div>
  );
}
