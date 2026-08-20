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
  metaEmpresas?: number;
  _count?: { prospects: number };
}

// Segmentos comuns para seleção por clique (o usuário pode adicionar outros)
const SEGMENTOS_SUGERIDOS = [
  "Loja de roupa", "Moda feminina", "Calçados", "Loja de cosméticos", "Perfumaria",
  "Salão de beleza", "Barbearia", "Clínica de estética", "Academia", "Studio de pilates",
  "Restaurante", "Lanchonete", "Pizzaria", "Cafeteria", "Padaria",
  "Petshop", "Clínica veterinária", "Loja de móveis", "Loja de decoração", "Material de construção",
  "Clínica odontológica", "Clínica médica", "Farmácia", "Ótica", "Loja de celular",
  "Auto peças", "Oficina mecânica", "Lava jato", "Imobiliária", "Escritório de contabilidade",
  "Escola de idiomas", "Curso profissionalizante", "Advocacia", "Corretora de seguros", "Gráfica",
];

// Cidades sugeridas (GO + capitais próximas) — o usuário pode adicionar outras
const CIDADES_SUGERIDAS = [
  "Goiânia", "Aparecida de Goiânia", "Anápolis", "Rio Verde", "Trindade",
  "Senador Canedo", "Catalão", "Itumbiara", "Jataí", "Luziânia",
  "Brasília", "Uberlândia", "Uberaba",
];

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
      if (!res.ok && res.status !== 202) throw new Error(String(data.error ?? res.status));

      // Sourcing grande roda em lotes encadeados (202) — acompanha até terminar
      if (acao === "sourcing" && data.status === "em_andamento") {
        setFeedback("Busca iniciada… pode levar alguns minutos para metas grandes. Vou atualizando a contagem.");
        await new Promise<void>((resolve) => {
          const iv = setInterval(async () => {
            try {
              const st = await fetch(`/api/prospeccao/sourcing/${segId}`).then((r) => r.json()) as {
                emAndamento: { inseridos: number; meta: number } | null;
                ultimoResultado: { status: string; motivo: string | null; resultado: Record<string, unknown> } | null;
              };
              await carregar();

              if (st.emAndamento) {
                setFeedback(`Buscando… ${st.emAndamento.inseridos} de ${st.emAndamento.meta} empresas.`);
                return;
              }

              clearInterval(iv);
              const r = st.ultimoResultado?.resultado ?? {};
              setFeedback(
                st.ultimoResultado?.status === "ERRO"
                  ? `Busca interrompida: ${st.ultimoResultado.motivo ?? "erro desconhecido"}`
                  : `Busca concluída: ${r.inseridos ?? 0} novas empresas, ${r.ignorados ?? 0} já existentes.`,
              );
              resolve();
            } catch { /* segue tentando */ }
          }, 8_000);
        });
        return;
      }

      setFeedback(
        acao === "sourcing"   ? `Busca concluída: ${(data as { inseridos?: number }).inseridos ?? 0} novas empresas, ${(data as { ignorados?: number }).ignorados ?? 0} já existentes.` :
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
        ) : !org ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Search className="w-10 h-10 opacity-40" />
            <p className="text-sm font-medium">Nenhuma organização de prospecção configurada</p>
            <p className="text-xs max-w-sm text-center">
              Execute o seed na VPS: <code className="px-1 py-0.5 rounded bg-muted text-xs">npx tsx prisma/seed-nexo.ts</code> e recarregue a página.
            </p>
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
                  <Link
                    href={`/crm/prospeccao/leads/${seg.id}`}
                    className="text-xs font-semibold px-2 py-1 rounded-lg bg-primary/10 text-primary shrink-0 hover:bg-primary/20 transition-colors"
                  >
                    {seg._count?.prospects ?? 0} empresas
                  </Link>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {seg.cidades.join(", ")}
                  </span>
                  {seg.metaEmpresas ? (
                    <span className="flex items-center gap-1">
                      <Search className="w-3 h-3" /> meta {seg.metaEmpresas.toLocaleString("pt-BR")}
                    </span>
                  ) : null}
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
  const [segmentosSel, setSegmentosSel] = useState<string[]>([]);
  const [cidadesSel, setCidadesSel] = useState<string[]>(["Goiânia"]);
  const [customSeg, setCustomSeg] = useState("");
  const [customCidade, setCustomCidade] = useState("");
  const [meta, setMeta] = useState(1000);
  const [apenasCelular, setApenasCelular] = useState(true);
  const [filtroSite, setFiltroSite] = useState("TODOS");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoesSeg = Array.from(new Set([...SEGMENTOS_SUGERIDOS, ...segmentosSel]));
  const opcoesCidade = Array.from(new Set([...CIDADES_SUGERIDAS, ...cidadesSel]));

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const salvar = async () => {
    if (segmentosSel.length === 0 || cidadesSel.length === 0) {
      setErro("Selecione ao menos 1 segmento e 1 cidade.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const nomeFinal = nome.trim() || `${segmentosSel[0]}${segmentosSel.length > 1 ? ` +${segmentosSel.length - 1}` : ""} — ${cidadesSel[0]}${cidadesSel.length > 1 ? ` +${cidadesSel.length - 1}` : ""}`;
      const res = await fetch("/api/prospeccao/segmentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          nome: nomeFinal,
          termoBusca: segmentosSel[0],
          termosSecundarios: segmentosSel.slice(1),
          cidades: cidadesSel,
          metaEmpresas: meta,
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

  const chipCls = (ativo: boolean) =>
    `px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
      ativo ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/10"
    }`;

  // Estimativa: ~min(meta, segmentos×cidades×~40)
  const potencial = segmentosSel.length * cidadesSel.length * 40;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl border border-border bg-card p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Nova busca de empresas</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmentos por clique */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              Segmentos ({segmentosSel.length} selecionados) — clique para escolher
            </label>
            {segmentosSel.length > 0 && (
              <button onClick={() => setSegmentosSel([])} className="text-xs text-muted-foreground hover:text-foreground">limpar</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-auto p-1">
            {opcoesSeg.map((s) => (
              <button key={s} type="button" onClick={() => toggle(segmentosSel, setSegmentosSel, s)} className={chipCls(segmentosSel.includes(s))}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              value={customSeg}
              onChange={(e) => setCustomSeg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && customSeg.trim()) { toggle(segmentosSel, setSegmentosSel, customSeg.trim()); setCustomSeg(""); } }}
              placeholder="Adicionar outro segmento e Enter"
              className="flex-1 rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Cidades por clique */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              Cidades ({cidadesSel.length}) — clique para escolher
            </label>
            {cidadesSel.length > 0 && (
              <button onClick={() => setCidadesSel([])} className="text-xs text-muted-foreground hover:text-foreground">limpar</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-auto p-1">
            {opcoesCidade.map((c) => (
              <button key={c} type="button" onClick={() => toggle(cidadesSel, setCidadesSel, c)} className={chipCls(cidadesSel.includes(c))}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              value={customCidade}
              onChange={(e) => setCustomCidade(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && customCidade.trim()) { toggle(cidadesSel, setCidadesSel, customCidade.trim()); setCustomCidade(""); } }}
              placeholder="Adicionar outra cidade e Enter"
              className="flex-1 rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Meta + filtros */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Campo label="Meta de empresas">
            <input
              type="number" min={20} max={5000} step={100}
              value={meta}
              onChange={(e) => setMeta(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </Campo>
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

        <Campo label="Nome da busca (opcional)">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Deixe vazio para gerar automaticamente"
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Campo>

        {segmentosSel.length > 0 && cidadesSel.length > 0 && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
            {segmentosSel.length} segmento(s) × {cidadesSel.length} cidade(s). Meta: {meta.toLocaleString("pt-BR")} empresas.
            {potencial < meta && ` Dica: para chegar a ${meta.toLocaleString("pt-BR")}, adicione mais segmentos ou cidades (potencial atual ~${potencial.toLocaleString("pt-BR")}).`}
          </p>
        )}

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
