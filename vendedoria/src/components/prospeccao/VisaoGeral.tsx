"use client";

// Visão geral: o que fazer agora (próximos passos), alertas e KPIs.

import React from "react";
import {
  ArrowRight, AlertTriangle, AlertCircle, Loader2, Building2, CheckCircle2,
  Send, MessageCircle, CalendarCheck, Search, Sparkles, Info,
} from "lucide-react";
import { fmtNum, fmtPct, type Resumo } from "./api";
import { Carregando, EmptyState, btn } from "./ui";
import { useExecucoes } from "./execucoes";
import type { Navegar } from "./navegacao";

export function VisaoGeral({ resumo, navegar, novaBusca }: {
  resumo: Resumo | null;
  navegar: Navegar;
  novaBusca: () => void;
}) {
  const { progresso, executar } = useExecucoes();
  if (!resumo) return <Carregando />;

  const { kpis } = resumo;
  const emAndamento = Object.entries(progresso);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 space-y-6">
        {/* Alertas */}
        {resumo.alertas.length > 0 && (
          <div className="space-y-2">
            {resumo.alertas.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  a.tipo === "erro"
                    ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                }`}
              >
                {a.tipo === "erro" ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                <span className="flex-1">{a.msg}</span>
                <button onClick={() => navegar("disparo")} className="text-xs font-medium underline shrink-0">Resolver</button>
              </div>
            ))}
          </div>
        )}

        {/* Execuções em andamento */}
        {emAndamento.length > 0 && (
          <div className="space-y-2">
            {emAndamento.map(([id, p]) => {
              const busca = resumo.buscas.find((b) => b.id === id);
              return (
                <div key={id} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="font-medium text-foreground">{busca?.nome ?? "Busca"}</span>
                    <span className="text-muted-foreground">— {p.texto}</span>
                  </div>
                  {p.total > 0 && (
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (p.feito / p.total) * 100)}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Próximos passos */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">O que fazer agora</h2>
          {resumo.passos.length === 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <EmptyState
                icon={<CheckCircle2 className="w-6 h-6 text-green-500" />}
                titulo="Tudo em dia"
                descricao="Não há empresas esperando por você. Crie uma nova busca para abastecer o funil."
                acao={<button onClick={novaBusca} className={btn.primario}><Search className="w-4 h-4" /> Nova busca</button>}
              />
            </div>
          ) : (
            <ol className="space-y-2">
              {resumo.passos.map((p, i) => {
                const rodando = p.acao.segmentId ? progresso[p.acao.segmentId] : undefined;
                const nome = resumo.buscas.find((b) => b.id === p.acao.segmentId)?.nome;
                return (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 md:p-4">
                    <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.descricao}</p>
                    </div>
                    <button
                      disabled={!!rodando}
                      onClick={() => {
                        if (p.id === "primeira-busca") novaBusca();
                        else if (p.acao.executar && p.acao.segmentId) void executar(p.acao.segmentId, p.acao.executar, nome);
                        else navegar(p.acao.aba);
                      }}
                      className={`${i === 0 ? btn.primario : btn.secundario} shrink-0`}
                    >
                      {rodando ? <Loader2 className="w-4 h-4 animate-spin" /> : p.acao.executar === "pipeline" ? <Sparkles className="w-4 h-4" /> : null}
                      <span className="hidden sm:inline">{rodando ? "Em andamento" : p.acao.label}</span>
                      {!rodando && <ArrowRight className="w-4 h-4" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* KPIs */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Números gerais</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi icon={<Building2 className="w-4 h-4" />} label="Empresas encontradas" valor={fmtNum(kpis.total)} />
            <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="Prontas p/ abordar" valor={fmtNum(kpis.aprovadas)} />
            <Kpi icon={<Send className="w-4 h-4" />} label="Abordadas" valor={fmtNum(kpis.abordados)} />
            <Kpi
              icon={<MessageCircle className="w-4 h-4" />}
              label="Responderam"
              valor={fmtNum(kpis.responderam)}
              sub={kpis.abordados ? `${fmtPct(kpis.taxaResposta)} das abordadas` : undefined}
            />
            <Kpi
              icon={<CalendarCheck className="w-4 h-4" />}
              label="Reuniões"
              valor={fmtNum(kpis.reunioes)}
              sub={kpis.abordados ? `${fmtPct(kpis.taxaReuniao)} das abordadas` : undefined}
            />
          </div>
        </section>

        {/* Como funciona */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Como funciona</h2>
          </div>
          <ol className="grid gap-3 md:grid-cols-4 text-xs text-muted-foreground">
            {[
              ["Buscar", "Você escolhe segmentos e cidades; encontramos as empresas no Google Maps."],
              ["Qualificar", "A IA verifica site, anúncios e Instagram, dá um score e decide quem vale abordar."],
              ["Revisar", "Os casos em dúvida vêm para você aprovar ou descartar em segundos."],
              ["Abordar", "As aprovadas recebem o template no WhatsApp com cadência anti-bloqueio; o agente SDR continua a conversa."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-muted text-foreground text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span><strong className="text-foreground">{t}.</strong> {d}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Kpi({ icon, label, valor, sub }: { icon: React.ReactNode; label: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground mt-1">{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
