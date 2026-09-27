"use client";

// Revisão em modo foco: uma empresa por vez, decisão com um clique ou tecla
// (A aprova, D descarta, ← → navegam). Só chegam aqui os casos em que a IA
// ficou em dúvida (status ANALISADO).

import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, Phone, Smartphone, MapPin, Globe,
  Star, Instagram, Brain, Loader2, PartyPopper, Keyboard, ListChecks,
} from "lucide-react";
import { api, fmtNum, fmtTelefone, linkSite, type Busca, type EmpresaResumo } from "./api";
import { Carregando, EmptyState, ScorePill, Sinal, btn, useAviso } from "./ui";
import type { Navegar } from "./navegacao";

export function Revisao({ orgId, segmentIdInicial, buscas, aoMudar, navegar }: {
  orgId: string;
  segmentIdInicial: string;
  buscas: Busca[];
  aoMudar: () => void;
  navegar: Navegar;
}) {
  const avisar = useAviso();
  const [segmentId, setSegmentId] = useState(segmentIdInicial);
  const [fila, setFila] = useState<EmpresaResumo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [idx, setIdx] = useState(0);
  const [agindo, setAgindo] = useState<"aprovar" | "descartar" | null>(null);
  const [decididas, setDecididas] = useState({ aprovadas: 0, descartadas: 0 });
  const [scoreLote, setScoreLote] = useState(5);
  const [aprovandoLote, setAprovandoLote] = useState(false);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ orgId, status: "ANALISADO", ordem: "score", pageSize: "50" });
    if (segmentId) q.set("segmentId", segmentId);
    try {
      const d = await api<{ empresas: EmpresaResumo[]; total: number }>(`/api/prospeccao/empresas?${q}`);
      setFila(d.empresas);
      setTotal(d.total);
      setIdx(0);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
      setFila([]);
    }
  }, [orgId, segmentId, avisar]);

  useEffect(() => { setFila(null); void carregar(); }, [carregar]);

  const atual = fila?.[idx] ?? null;

  const decidir = useCallback(async (acao: "aprovar" | "descartar") => {
    if (!atual || agindo) return;
    setAgindo(acao);
    try {
      await api(`/api/prospeccao/empresas/${atual.id}`, { method: "PATCH", json: { acao } });
      setDecididas((d) => acao === "aprovar" ? { ...d, aprovadas: d.aprovadas + 1 } : { ...d, descartadas: d.descartadas + 1 });
      setTotal((t) => t - 1);
      const resto = (fila ?? []).filter((x) => x.id !== atual.id);
      setFila(resto);
      setIdx((i) => Math.min(i, Math.max(0, resto.length - 1)));
      aoMudar();
      // Acabou a página carregada mas ainda há mais no servidor → busca a próxima leva.
      if (resto.length === 0 && total - 1 > 0) void carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setAgindo(null);
    }
  }, [atual, agindo, fila, total, aoMudar, carregar, avisar]);

  // Atalhos de teclado
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement;
      if (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === "a") { ev.preventDefault(); void decidir("aprovar"); }
      else if (k === "d") { ev.preventDefault(); void decidir("descartar"); }
      else if (k === "arrowright") setIdx((i) => Math.min(i + 1, (fila?.length ?? 1) - 1));
      else if (k === "arrowleft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [decidir, fila]);

  const aprovarLote = async () => {
    if (!confirm(`Aprovar todas as empresas em revisão com score ≥ ${scoreLote}${segmentId ? " desta busca" : ""}?`)) return;
    setAprovandoLote(true);
    try {
      const r = await api<{ aprovados: number }>("/api/prospeccao/fila/aprovar-score", {
        method: "POST",
        json: { orgId, scoreMin: scoreLote, ...(segmentId ? { segmentId } : {}) },
      });
      avisar(`${r.aprovados} empresa(s) aprovada(s).`);
      aoMudar();
      await carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setAprovandoLote(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Barra superior */}
      <div className="px-4 md:px-6 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2">
        <select
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
          className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="">Todas as buscas</option>
          {buscas.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">
          <strong className="text-foreground">{fmtNum(Math.max(total, 0))}</strong> aguardando
          {(decididas.aprovadas + decididas.descartadas) > 0 && (
            <> · nesta sessão: {decididas.aprovadas} aprovadas, {decididas.descartadas} descartadas</>
          )}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground hidden sm:inline">Aprovar todas com score ≥</span>
          <select value={scoreLote} onChange={(e) => setScoreLote(Number(e.target.value))}
            className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm outline-none" aria-label="Score mínimo">
            {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={() => void aprovarLote()} disabled={aprovandoLote || total === 0} className={`${btn.secundario} !py-1.5`}>
            {aprovandoLote ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            <span className="hidden sm:inline">Aprovar em lote</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {fila === null ? (
          <Carregando />
        ) : !atual ? (
          <EmptyState
            icon={<PartyPopper className="w-6 h-6 text-green-500" />}
            titulo="Nada para revisar"
            descricao="Todas as empresas em dúvida já foram decididas. As aprovadas seguem para o disparo."
            acao={
              <div className="flex gap-2">
                <button onClick={() => navegar("empresas", { status: "APROVADO" })} className={btn.secundario}>Conferir aprovadas</button>
                <button onClick={() => navegar("disparo")} className={btn.primario}>Ir para disparo</button>
              </div>
            }
          />
        ) : (
          <div className="max-w-2xl mx-auto px-4 md:px-6 py-5">
            <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
              <span>{idx + 1} de {fila.length}{total > fila.length ? ` (${fmtNum(total)} no total)` : ""}</span>
              <span className="hidden md:flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> A aprova · D descarta · ← → navega</span>
            </div>

            <article key={atual.id} className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
              <header className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground">{atual.nome ?? "Nome não informado"}</h2>
                  <p className="text-xs text-muted-foreground">{atual.segment?.nome ?? "Importada"}</p>
                </div>
                <div className="text-right">
                  <ScorePill score={atual.score} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">score</p>
                </div>
              </header>

              <div className="grid gap-2 text-sm">
                <p className="flex items-center gap-2 text-foreground">
                  {atual.tipoTelefone === "CELULAR" ? <Smartphone className="w-4 h-4 text-green-500" /> : <Phone className="w-4 h-4 text-muted-foreground" />}
                  {fmtTelefone(atual.telefone)}
                  {atual.tipoTelefone === "FIXO" && <span className="text-xs text-amber-600 dark:text-amber-400">fixo — não recebe WhatsApp</span>}
                </p>
                {atual.enderecoCompleto && (
                  <p className="flex items-start gap-2 text-muted-foreground"><MapPin className="w-4 h-4 shrink-0 mt-0.5" /> {atual.enderecoCompleto}</p>
                )}
                {atual.ratingGoogle != null && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" /> {atual.ratingGoogle.toFixed(1)} ({atual.numeroAvaliacoes ?? 0} avaliações)
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Sinal value={atual.temSite} label="Site" />
                <Sinal value={atual.temAnuncioAtivo} label="Anúncio ativo" />
                <Sinal value={atual.instagramAtivo} label="Instagram ativo" />
                {atual.followersIG != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border text-[11px] text-muted-foreground">
                    <Instagram className="w-3 h-3" /> {atual.followersIG.toLocaleString("pt-BR")}
                  </span>
                )}
                {atual.website && (
                  <a href={linkSite(atual.website)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 text-[11px] text-primary hover:underline">
                    <Globe className="w-3 h-3" /> Ver site
                  </a>
                )}
              </div>

              {atual.motivoAnaliseIA && (
                <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1"><Brain className="w-3.5 h-3.5 text-primary" /> Por que a IA ficou em dúvida</p>
                  <p className="text-xs text-muted-foreground">{atual.motivoAnaliseIA}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button onClick={() => void decidir("descartar")} disabled={!!agindo} className={`${btn.perigo} py-3`}>
                  {agindo === "descartar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Descartar <kbd className="hidden md:inline text-[10px] opacity-60 ml-1">D</kbd>
                </button>
                <button onClick={() => void decidir("aprovar")} disabled={!!agindo} className={`${btn.sucesso} py-3`}>
                  {agindo === "aprovar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprovar <kbd className="hidden md:inline text-[10px] opacity-60 ml-1">A</kbd>
                </button>
              </div>
            </article>

            <div className="flex items-center justify-between mt-3">
              <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className={btn.fantasma}>
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
              <button onClick={() => setIdx((i) => Math.min(fila.length - 1, i + 1))} disabled={idx >= fila.length - 1} className={btn.fantasma}>
                Pular <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
