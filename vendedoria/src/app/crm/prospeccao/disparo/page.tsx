"use client";

// Disparo — template de abordagem, cadência anti-ban e execução manual.

import React, { useState, useEffect, useCallback, useRef } from "react";
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

interface LeadFila {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  tentativasDisparo: number;
}

interface FilaDisparo {
  resumo: {
    naFila: number;
    aguardando: number;
    processando: number;
    concluidos: number;
    falhas: number;
    previstosProximoLote: number;
    totalJaEnviados: number;
  };
  janela: {
    dentroJanela: boolean;
    horaAtualBRT: number;
    janela: string;
    limiteDiario: number;
    pausado: boolean;
  };
  fila: Array<{ jobId: string; status: string; criadoEm: string; lead: LeadFila }>;
  previstos: Array<LeadFila & { score: number | null; sinalOportunidade: string | null }>;
  ultimosEnviados: Array<LeadFila & { dataAbordagem: string | null }>;
}

function fmtTel(t: string | null): string {
  if (!t) return "—";
  const d = t.replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return t;
}

function fmtHora(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const VARIAVEIS_DISPONIVEIS = ["nomeNegocio", "sinalOportunidade", "tipoNegocio", "telefone", "website"];
const inputCls = "w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary";

export default function DisparoPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [orgChecked, setOrgChecked] = useState(false);
  const [config, setConfig] = useState<DisparoConfig | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [novoTemplate, setNovoTemplate] = useState("");
  const [variaveisSel, setVariaveisSel] = useState<string[]>(["nomeNegocio"]);
  const [salvando, setSalvando] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [statusDisparo, setStatusDisparo] = useState<string | null>(null);
  const [aprovados, setAprovados] = useState<number>(0);
  const [fila, setFila] = useState<FilaDisparo | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const filaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (filaPollRef.current) clearInterval(filaPollRef.current);
    };
  }, []);

  const carregarFila = useCallback(async (orgId: string) => {
    try {
      const f = await fetch(`/api/prospeccao/disparo/fila/${orgId}`).then((r) => r.json()) as FilaDisparo;
      setFila(f);
    } catch { /* ignora erro de rede no polling */ }
  }, []);

  const carregar = useCallback(async () => {
    const orgs = await fetch("/api/prospeccao/orgs").then((r) => r.json()) as Org[];
    const o = orgs[0] ?? null;
    setOrg(o);
    setOrgChecked(true);
    if (!o) return;
    const [cfg, tpls, filaAprovados] = await Promise.all([
      fetch(`/api/prospeccao/disparo-config/${o.id}`).then((r) => r.json()) as Promise<DisparoConfig>,
      fetch(`/api/prospeccao/templates?orgId=${o.id}`).then((r) => r.json()) as Promise<Template[]>,
      fetch(`/api/prospeccao/fila?status=APROVADO&orgId=${o.id}`).then((r) => r.json()) as Promise<{ total: number }>,
    ]);
    setConfig(cfg);
    setTemplates(Array.isArray(tpls) ? tpls : []);
    setAprovados(filaAprovados.total ?? 0);
    void carregarFila(o.id);
  }, [carregarFila]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Atualiza a fila a cada 5s enquanto um disparo está rodando; senão, a cada 20s
  useEffect(() => {
    if (!org) return;
    if (filaPollRef.current) clearInterval(filaPollRef.current);
    filaPollRef.current = setInterval(() => void carregarFila(org.id), disparando ? 5_000 : 20_000);
    return () => { if (filaPollRef.current) clearInterval(filaPollRef.current); };
  }, [org, disparando, carregarFila]);

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
      const data = await res.json() as {
        ok: boolean; error?: string; status?: string; motivo?: string;
        disparados?: number; ignorados?: number; erros?: number;
      };
      if (res.status === 422 || (!res.ok && data.motivo)) {
        setStatusDisparo(`⚠️ Disparo bloqueado: ${data.motivo ?? data.error}`);
        setDisparando(false);
        return;
      }
      if (!res.ok || !data.ok) {
        setStatusDisparo(`Não iniciado: ${data.error ?? "erro"}`);
        setDisparando(false);
        return;
      }
      if (data.status === "concluido") {
        setStatusDisparo(`✅ Concluído: ${data.disparados ?? 0} enviados, ${data.ignorados ?? 0} ignorados, ${data.erros ?? 0} erros`);
        setDisparando(false);
        void carregar();
        return;
      }
      // Poll do status a cada 15s
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        void (async () => {
          const st = await fetch(`/api/prospeccao/disparo/executar/${org.id}`).then((r) => r.json()) as {
            emAndamento: unknown; ultimoResultado: { resultado: unknown } | null;
          };
          if (!st.emAndamento) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
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

  const templatesAtivos = templates.filter((t) => t.ativo);
  const templateAtivo = templatesAtivos[0];
  // Elegíveis = aprovados + retentativas (não só APROVADO). Fallback pro count antigo.
  const elegiveis = fila?.resumo.previstosProximoLote ?? aprovados;

  if (orgChecked && !org) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Send className="w-10 h-10 opacity-40" />
        <p className="text-sm font-medium">Nenhuma organização de prospecção configurada</p>
        <p className="text-xs max-w-sm text-center">
          Execute o seed na VPS: <code className="px-1 py-0.5 rounded bg-muted text-xs">npx tsx prisma/seed-nexo.ts</code> e recarregue a página.
        </p>
      </div>
    );
  }

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
              {elegiveis} lead(s) elegíveis aguardando abordagem
              {fila && fila.resumo.naFila > 0 && ` · ${fila.resumo.naFila} na fila agora`}
            </p>
          </div>
        </div>
        <button
          onClick={() => void dispararAgora()}
          disabled={disparando || !templateAtivo || config.pausadoManualmente || elegiveis === 0}
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

        {/* Fila de disparo em tempo real */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Fila de disparo (tempo real)</h2>
            </div>
            <button
              onClick={() => org && void carregarFila(org.id)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          </div>

          {/* Cartões de resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatFila label="Previstos" value={fila?.resumo.previstosProximoLote ?? 0} tone="neutral" />
            <StatFila label="Aguardando" value={fila?.resumo.aguardando ?? 0} tone="amber" />
            <StatFila label="Enviando agora" value={fila?.resumo.processando ?? 0} tone="blue" pulse={(fila?.resumo.processando ?? 0) > 0} />
            <StatFila label="Já enviados" value={fila?.resumo.totalJaEnviados ?? 0} tone="green" />
          </div>

          {/* Aviso de janela / pausa */}
          {fila && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${
              fila.janela.pausado
                ? "border-red-500/40 bg-red-500/5 text-red-500"
                : fila.janela.dentroJanela
                  ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
                  : "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400"
            }`}>
              {fila.janela.pausado
                ? "⏸ Disparos pausados manualmente — retome abaixo para voltar a enviar."
                : fila.janela.dentroJanela
                  ? `✓ Dentro da janela comercial (${fila.janela.janela} BRT) — os disparos rodam automaticamente a cada hora. Agora são ${fila.janela.horaAtualBRT}h.`
                  : `⏱ Fora da janela comercial (${fila.janela.janela} BRT, agora ${fila.janela.horaAtualBRT}h). Os leads ficam na fila e disparam quando a janela abrir. Use "Disparar agora" para enviar imediatamente.`}
            </div>
          )}

          {/* Fila ativa (QUEUED/RUNNING) */}
          {fila && fila.fila.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Na fila agora ({fila.fila.length})</p>
              <div className="max-h-52 overflow-auto rounded-lg border border-border divide-y divide-border">
                {fila.fila.map((j) => (
                  <div key={j.jobId} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{j.lead.nome ?? "(sem nome)"}</p>
                      <p className="text-muted-foreground">{fmtTel(j.lead.telefone)}</p>
                    </div>
                    <span className={`shrink-0 ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      j.status === "RUNNING"
                        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 animate-pulse"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    }`}>
                      {j.status === "RUNNING" ? "enviando" : "aguardando"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Previstos (próximo lote) */}
          {fila && fila.previstos.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Previstos para o próximo lote ({fila.previstos.length}) — limite {fila.janela.limiteDiario}/dia
              </p>
              <div className="max-h-52 overflow-auto rounded-lg border border-border divide-y divide-border">
                {fila.previstos.slice(0, 50).map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{l.nome ?? "(sem nome)"}</p>
                      <p className="text-muted-foreground">{fmtTel(l.telefone)}</p>
                    </div>
                    <div className="shrink-0 ml-2 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                        {l.status === "APROVADO" ? "1º contato" : `${l.tentativasDisparo + 1}º contato`}
                      </span>
                      {l.score != null && <p className="text-[10px] text-muted-foreground mt-0.5">score {l.score}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Últimos enviados */}
          {fila && fila.ultimosEnviados.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Últimos enviados ({fila.ultimosEnviados.length})</p>
              <div className="max-h-52 overflow-auto rounded-lg border border-border divide-y divide-border">
                {fila.ultimosEnviados.map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{l.nome ?? "(sem nome)"}</p>
                      <p className="text-muted-foreground">{fmtTel(l.telefone)}</p>
                    </div>
                    <div className="shrink-0 ml-2 text-right">
                      <p className="text-[10px] text-muted-foreground">{fmtHora(l.dataAbordagem)}</p>
                      <span className="text-[10px] text-muted-foreground">tentativa {l.tentativasDisparo}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fila && fila.fila.length === 0 && fila.previstos.length === 0 && fila.ultimosEnviados.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhum lead na fila. Aprove leads na tela de Prospecção para começar a disparar.
            </p>
          )}
        </section>

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

          {templatesAtivos.length > 0 ? (
            <div className="space-y-2">
              {templatesAtivos.map((t) => (
                <div key={t.id} className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">✓ Ativo: {t.nomeTemplateMeta}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Idioma: {t.idioma} · Variáveis: {t.variaveis.join(", ") || "nenhuma"}
                  </p>
                </div>
              ))}
              {templatesAtivos.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  🔀 {templatesAtivos.length} templates ativos — o disparo alterna entre eles (teste A/B). Compare a taxa de resposta no Dashboard.
                </p>
              )}
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

function StatFila({ label, value, tone, pulse }: {
  label: string;
  value: number;
  tone: "neutral" | "amber" | "blue" | "green";
  pulse?: boolean;
}) {
  const toneCls = {
    neutral: "text-foreground",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <p className={`text-2xl font-bold ${toneCls} ${pulse ? "animate-pulse" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
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
