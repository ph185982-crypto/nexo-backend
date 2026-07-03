"use client";

// Prospecções — hub central: buscas (segmentos), pipeline de qualificação e disparo.

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, Search, Sparkles, Brain, ListChecks, Send,
  RefreshCw, X, Smartphone, Globe, MapPin, Loader2,
} from "lucide-react";

interface Org { id: string; name: string }

interface Segmento {
  id: string;
  nome: string;
  termoBusca: string;
  termosSecundarios: string[];
  cidades: string[];
  apenasCelular?: boolean;
  filtroSite?: string;
  _count?: { prospects: number };
}

interface Metricas {
  porStatus: Record<string, number>;
}

const FUNIL_ORDER = [
  ["NOVO", "Novos"],
  ["ENRIQUECIDO", "Enriquecidos"],
  ["PONTUADO", "Pontuados"],
  ["ANALISADO", "P/ revisão"],
  ["APROVADO", "Aprovados"],
  ["ABORDADO", "Abordados"],
  ["RESPONDEU", "Responderam"],
  ["QUALIFICADO", "Qualificados"],
  ["REUNIAO_AGENDADA", "Reuniões"],
] as const;

export default function ProspeccoesPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [acaoLoading, setAcaoLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const orgs = await fetch("/api/prospeccao/orgs").then((r) => r.json()) as Org[];
      const o = orgs[0] ?? null;
      setOrg(o);
      if (o) {
        const [segs, met] = await Promise.all([
          fetch(`/api/prospeccao/segmentos?orgId=${o.id}`).then((r) => r.json()) as Promise<Segmento[]>,
          fetch(`/api/prospeccao/metricas/${o.id}`).then((r) => r.json()) as Promise<Metricas>,
        ]);
        setSegmentos(Array.isArray(segs) ? segs : []);
        setMetricas(met);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const rodarAcao = async (segId: string, acao: "sourcing" | "enriquecer" | "analisar") => {
    const chave = `${segId}:${acao}`;
    setAcaoLoading(chave);
    setFeedback(null);
    try {
      const url =
        acao === "sourcing"   ? `/api/prospeccao/sourcing/${segId}` :
        acao === "enriquecer" ? `/api/prospeccao/enriquecimento/lote/${segId}` :
        `/api/prospeccao/analise/lote/${segId}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? res.status));
      setFeedback(
        acao === "sourcing"   ? `Busca concluída: ${JSON.stringify(data.resultado ?? data)}` :
        acao === "enriquecer" ? `Enriquecimento concluído: ${JSON.stringify(data.resultado ?? data)}` :
        `Análise IA concluída: ${JSON.stringify(data.resultado ?? data)}`,
      );
      await carregar();
    } catch (e) {
      setFeedback(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAcaoLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Prospecções</h1>
          <p className="text-sm text-muted-foreground">
            Encontre empresas, qualifique com IA e dispare abordagens
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/crm/prospeccao/disparo"
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-accent/10 transition-colors"
          >
            <Send className="w-4 h-4" />
            Disparo
          </Link>
          <Link
            href="/crm/prospeccao/fila"
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-accent/10 transition-colors"
          >
            <ListChecks className="w-4 h-4" />
            Fila de aprovação
          </Link>
          <button
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Nova busca
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {/* Funil resumo */}
        {metricas && (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {FUNIL_ORDER.map(([status, label]) => (
              <div key={status} className="rounded-lg border border-border bg-card p-3 text-center">
                <div className="text-xl font-semibold text-foreground">
                  {metricas.porStatus?.[status] ?? 0}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
              </div>
            ))}
          </div>
        )}

        {feedback && (
          <div className="text-sm rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
            {feedback}
          </div>
        )}

        {/* Lista de buscas */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : segmentos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Search className="w-10 h-10 opacity-40" />
            <p className="text-sm">Nenhuma busca criada ainda</p>
            <button
              onClick={() => setModalAberto(true)}
              className="text-sm text-primary hover:underline"
            >
              Criar a primeira busca
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {segmentos.map((seg) => (
              <div key={seg.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">{seg.nome}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      &quot;{seg.termoBusca}&quot;
                      {seg.termosSecundarios.length > 0 && ` +${seg.termosSecundarios.length} termos`}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-primary/10 text-primary shrink-0">
                    {seg._count?.prospects ?? 0} empresas
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {seg.cidades.join(", ")}
                  </span>
                  {seg.apenasCelular && (
                    <span className="flex items-center gap-1 text-primary">
                      <Smartphone className="w-3 h-3" /> só celular
                    </span>
                  )}
                  {seg.filtroSite && seg.filtroSite !== "TODOS" && (
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {seg.filtroSite === "SEM_SITE" ? "sem site" : "com site"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <BotaoAcao
                    icon={<Search className="w-3.5 h-3.5" />}
                    label="1. Buscar"
                    loading={acaoLoading === `${seg.id}:sourcing`}
                    disabled={!!acaoLoading}
                    onClick={() => void rodarAcao(seg.id, "sourcing")}
                  />
                  <BotaoAcao
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    label="2. Enriquecer"
                    loading={acaoLoading === `${seg.id}:enriquecer`}
                    disabled={!!acaoLoading}
                    onClick={() => void rodarAcao(seg.id, "enriquecer")}
                  />
                  <BotaoAcao
                    icon={<Brain className="w-3.5 h-3.5" />}
                    label="3. Analisar IA"
                    loading={acaoLoading === `${seg.id}:analisar`}
                    disabled={!!acaoLoading}
                    onClick={() => void rodarAcao(seg.id, "analisar")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalAberto && org && (
        <ModalNovaBusca
          orgId={org.id}
          onClose={() => setModalAberto(false)}
          onCreated={() => { setModalAberto(false); void carregar(); }}
        />
      )}
    </div>
  );
}

function BotaoAcao({ icon, label, loading, disabled, onClick }: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent/10 disabled:opacity-50 transition-colors"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function ModalNovaBusca({ orgId, onClose, onCreated }: {
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [termo, setTermo] = useState("");
  const [termosSec, setTermosSec] = useState("");
  const [cidades, setCidades] = useState("");
  const [apenasCelular, setApenasCelular] = useState(true);
  const [filtroSite, setFiltroSite] = useState("TODOS");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    if (!nome.trim() || !termo.trim() || !cidades.trim()) {
      setErro("Preencha nome, termo de busca e ao menos uma cidade.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/prospeccao/segmentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          nome: nome.trim(),
          termoBusca: termo.trim(),
          termosSecundarios: termosSec.split(",").map((s) => s.trim()).filter(Boolean),
          cidades: cidades.split(",").map((s) => s.trim()).filter(Boolean),
          apenasCelular,
          filtroSite,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onCreated();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Nova busca de empresas</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <Campo label="Nome da busca">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Lojas de moda — Goiânia"
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Campo>

        <Campo label="Segmento (termo de busca)">
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Ex.: loja de roupa"
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Campo>

        <Campo label="Termos extras (separados por vírgula)">
          <input
            value={termosSec}
            onChange={(e) => setTermosSec(e.target.value)}
            placeholder="boutique, moda feminina"
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Campo>

        <Campo label="Cidades (separadas por vírgula)">
          <input
            value={cidades}
            onChange={(e) => setCidades(e.target.value)}
            placeholder="Goiânia, Aparecida de Goiânia"
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Campo>

        <div className="grid grid-cols-2 gap-4">
          <Campo label="Telefone">
            <select
              value={apenasCelular ? "CELULAR" : "TODOS"}
              onChange={(e) => setApenasCelular(e.target.value === "CELULAR")}
              className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="CELULAR">Só celular (WhatsApp)</option>
              <option value="TODOS">Qualquer telefone</option>
            </select>
          </Campo>
          <Campo label="Site">
            <select
              value={filtroSite}
              onChange={(e) => setFiltroSite(e.target.value)}
              className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="TODOS">Com ou sem site</option>
              <option value="SEM_SITE">Só sem site</option>
              <option value="COM_SITE">Só com site</option>
            </select>
          </Campo>
        </div>

        {erro && <p className="text-sm text-red-500">{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => void salvar()}
            disabled={salvando}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            Criar busca
          </button>
        </div>
      </div>

    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
