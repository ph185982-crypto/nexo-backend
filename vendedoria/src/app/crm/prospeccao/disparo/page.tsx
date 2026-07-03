"use client";

// Disparo — template de abordagem, cadência anti-ban e execução manual.

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Send, Save, Loader2, Pause, Play,
  ShieldCheck, Clock, MessageSquareText, RefreshCw,
} from "lucide-react";

interface Org { id: string; name: string }

interface Template {
  id: string;
  nomeTemplateMeta: string;
  idioma: string;
  variaveis: string[];
  ativo: boolean;
}

interface DisparoConfig {
  limiteDiarioAtual: number;
  incrementoSemanal: number;
  limiteMaximoDiario: number;
  janelaInicioHora: number;
  janelaFimHora: number;
  diasSemana: number[];
  pausadoManualmente: boolean;
  motivoPausa: string | null;
  diasEntreTentativas: number;
  maxTentativasContato: number;
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const VARIAVEIS_DISPONIVEIS = ["nomeNegocio", "sinalOportunidade", "tipoNegocio", "telefone", "website"];
const inputCls = "w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary";

export default function DisparoPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [config, setConfig] = useState<DisparoConfig | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [novoTemplate, setNovoTemplate] = useState("");
  const [variaveisSel, setVariaveisSel] = useState<string[]>(["nomeNegocio"]);
  const [salvando, setSalvando] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [statusDisparo, setStatusDisparo] = useState<string | null>(null);
  const [aprovados, setAprovados] = useState<number>(0);

  const carregar = useCallback(async () => {
    const orgs = await fetch("/api/prospeccao/orgs").then((r) => r.json()) as Org[];
    const o = orgs[0] ?? null;
    setOrg(o);
    if (!o) return;
    const [cfg, tpls, fila] = await Promise.all([
      fetch(`/api/prospeccao/disparo-config/${o.id}`).then((r) => r.json()) as Promise<DisparoConfig>,
      fetch(`/api/prospeccao/templates?orgId=${o.id}`).then((r) => r.json()) as Promise<Template[]>,
      fetch(`/api/prospeccao/fila?status=APROVADO&orgId=${o.id}`).then((r) => r.json()) as Promise<{ total: number }>,
    ]);
    setConfig(cfg);
    setTemplates(Array.isArray(tpls) ? tpls : []);
    setAprovados(fila.total ?? 0);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvarConfig = async (patch: Partial<DisparoConfig>) => {
    if (!org || !config) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/prospeccao/disparo-config/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setConfig(await res.json() as DisparoConfig);
    } finally {
      setSalvando(false);
    }
  };

  const cadastrarTemplate = async () => {
    if (!org || !novoTemplate.trim()) return;
    setSalvando(true);
    try {
      await fetch("/api/prospeccao/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: org.id,
          nomeTemplateMeta: novoTemplate.trim(),
          variaveis: variaveisSel,
          ativo: true,
        }),
      });
      setNovoTemplate("");
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  const dispararAgora = async () => {
    if (!org) return;
    setDisparando(true);
    setStatusDisparo("Disparo iniciado — enviando com intervalos de 30-90s entre mensagens (anti-bloqueio)...");
    try {
      const res = await fetch(`/api/prospeccao/disparo/executar/${org.id}`, { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatusDisparo(`Não iniciado: ${data.error ?? "erro"}`);
        setDisparando(false);
        return;
      }
      // Poll do status a cada 15s
      const poll = setInterval(() => {
        void (async () => {
          const st = await fetch(`/api/prospeccao/disparo/executar/${org.id}`).then((r) => r.json()) as {
            emAndamento: unknown; ultimoResultado: { resultado: unknown } | null;
          };
          if (!st.emAndamento) {
            clearInterval(poll);
            setDisparando(false);
            setStatusDisparo(`Concluído: ${JSON.stringify(st.ultimoResultado?.resultado ?? {})}`);
            void carregar();
          }
        })();
      }, 15_000);
    } catch (e) {
      setStatusDisparo(`Erro: ${e instanceof Error ? e.message : String(e)}`);
      setDisparando(false);
    }
  };

  const templateAtivo = templates.find((t) => t.ativo);

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Link href="/crm/prospeccao" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Disparo de abordagem</h1>
            <p className="text-sm text-muted-foreground">
              {aprovados} lead(s) aprovados aguardando abordagem
            </p>
          </div>
        </div>
        <button
          onClick={() => void dispararAgora()}
          disabled={disparando || !templateAtivo || config.pausadoManualmente || aprovados === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {disparando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Disparar agora
        </button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6 max-w-3xl">
        {statusDisparo && (
          <div className="text-sm rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
            {statusDisparo}
          </div>
        )}

        {/* Pausa/retomada */}
        <div className={`rounded-xl border p-4 flex items-center justify-between ${
          config.pausadoManualmente ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"
        }`}>
          <div className="flex items-center gap-3">
            <ShieldCheck className={`w-5 h-5 ${config.pausadoManualmente ? "text-red-500" : "text-primary"}`} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {config.pausadoManualmente ? "Disparos PAUSADOS" : "Disparos liberados"}
              </p>
              <p className="text-xs text-muted-foreground">
                {config.pausadoManualmente
                  ? config.motivoPausa ?? "pausado manualmente"
                  : "Proteções ativas: warm-up, janela de horário, intervalo aleatório e monitoramento de qualidade do número"}
              </p>
            </div>
          </div>
          <button
            onClick={() => void salvarConfig({ pausadoManualmente: !config.pausadoManualmente, motivoPausa: config.pausadoManualmente ? null : "pausado pelo usuário" })}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent/10 transition-colors"
          >
            {config.pausadoManualmente ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {config.pausadoManualmente ? "Retomar" : "Pausar"}
          </button>
        </div>

        {/* Template */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Modelo de mensagem (template Meta)</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            O primeiro contato usa um template aprovado no WhatsApp Business (obrigatório pela Meta).
            Crie o template no Gerenciador da Meta e cadastre o nome exato aqui.
          </p>

          {templateAtivo ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-sm font-medium text-foreground">✓ Ativo: {templateAtivo.nomeTemplateMeta}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Idioma: {templateAtivo.idioma} · Variáveis: {templateAtivo.variaveis.join(", ") || "nenhuma"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-500">Nenhum template ativo — cadastre abaixo para liberar o disparo.</p>
          )}

          <div className="space-y-3 pt-1">
            <input
              value={novoTemplate}
              onChange={(e) => setNovoTemplate(e.target.value)}
              placeholder="nome_do_template_na_meta (ex.: abordagem_nexo_v1)"
              className={inputCls}
            />
            <div className="flex flex-wrap gap-2">
              {VARIAVEIS_DISPONIVEIS.map((v) => (
                <button
                  key={v}
                  onClick={() => setVariaveisSel((prev) =>
                    prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                  )}
                  className={`px-2 py-1 rounded-lg border text-xs transition-colors ${
                    variaveisSel.includes(v)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/10"
                  }`}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <button
              onClick={() => void cadastrarTemplate()}
              disabled={salvando || !novoTemplate.trim()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent/10 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              Cadastrar e ativar
            </button>
          </div>
        </section>

        {/* Cadência */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Cadência e proteção do número</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <CampoNum label="Limite diário atual" value={config.limiteDiarioAtual}
              onSave={(v) => void salvarConfig({ limiteDiarioAtual: v })} hint="começa baixo (warm-up)" />
            <CampoNum label="Aumento semanal" value={config.incrementoSemanal}
              onSave={(v) => void salvarConfig({ incrementoSemanal: v })} hint="+ por semana" />
            <CampoNum label="Limite máximo/dia" value={config.limiteMaximoDiario}
              onSave={(v) => void salvarConfig({ limiteMaximoDiario: v })} />
            <CampoNum label="Início da janela (h)" value={config.janelaInicioHora}
              onSave={(v) => void salvarConfig({ janelaInicioHora: v })} />
            <CampoNum label="Fim da janela (h)" value={config.janelaFimHora}
              onSave={(v) => void salvarConfig({ janelaFimHora: v })} />
            <CampoNum label="Dias entre tentativas" value={config.diasEntreTentativas}
              onSave={(v) => void salvarConfig({ diasEntreTentativas: v })} hint="p/ 2º e 3º contato" />
            <CampoNum label="Máx. tentativas/lead" value={config.maxTentativasContato}
              onSave={(v) => void salvarConfig({ maxTentativasContato: v })} />
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Dias da semana</p>
            <div className="flex gap-2">
              {DIAS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => {
                    const dias = config.diasSemana.includes(i)
                      ? config.diasSemana.filter((x) => x !== i)
                      : [...config.diasSemana, i].sort();
                    void salvarConfig({ diasSemana: dias });
                  }}
                  className={`w-11 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    config.diasSemana.includes(i)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/10"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
            Proteções automáticas sempre ativas: intervalo aleatório de 30-90s entre mensagens,
            pausa automática se a Meta rebaixar a qualidade do número, nunca dispara para telefone fixo,
            e o warm-up aumenta o volume gradualmente toda sexta-feira.
          </p>
        </section>
      </div>
    </div>
  );
}

function CampoNum({ label, value, onSave, hint }: {
  label: string;
  value: number;
  onSave: (v: number) => void;
  hint?: string;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n !== value) onSave(n);
        }}
        className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
