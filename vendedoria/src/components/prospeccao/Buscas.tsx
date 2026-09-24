"use client";

// Buscas (segmentos): cada card mostra onde estão as empresas daquela busca e
// oferece UM próximo passo claro, com o resto das ações no menu.

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search, MapPin, Smartphone, Globe, MoreHorizontal, Sparkles, ClipboardCheck,
  Send, Loader2, Building2, Pencil, Copy, Archive, RefreshCw, Plus, ArrowRight,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { api, fmtNum, type Busca, type Resumo } from "./api";
import { Carregando, EmptyState, btn, useAviso } from "./ui";
import { useExecucoes, type Progresso } from "./execucoes";
import type { Navegar } from "./navegacao";

// Cores do progresso por etapa (mesma ordem do funil).
const SEGMENTOS_BARRA = [
  { id: "qualificar",  label: "Para qualificar", cor: "bg-slate-400" },
  { id: "revisar",     label: "Em revisão",      cor: "bg-amber-500" },
  { id: "abordar",     label: "Prontas",         cor: "bg-green-500" },
  { id: "conversando", label: "Em conversa",     cor: "bg-cyan-500" },
  { id: "ganhos",      label: "Qualificadas",    cor: "bg-violet-500" },
  { id: "encerrado",   label: "Descartadas",     cor: "bg-red-400/60" },
] as const;

export function Buscas({ resumo, navegar, recarregar, novaBusca, editar, duplicar }: {
  resumo: Resumo | null;
  navegar: Navegar;
  recarregar: () => Promise<void>;
  novaBusca: () => void;
  editar: (b: Busca) => void;
  duplicar: (b: Busca) => void;
}) {
  const sp = useSearchParams();
  const nova = sp.get("nova");

  if (!resumo) return <Carregando />;

  if (resumo.buscas.length === 0) {
    return (
      <EmptyState
        icon={<Search className="w-6 h-6" />}
        titulo="Nenhuma busca criada ainda"
        descricao="Uma busca define quais tipos de empresa e quais cidades você quer prospectar. Crie a primeira para começar."
        acao={<button onClick={novaBusca} className={btn.primario}><Plus className="w-4 h-4" /> Criar primeira busca</button>}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-4 md:px-6 py-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {resumo.buscas.map((b) => (
          <CardBusca
            key={b.id}
            busca={b}
            recemCriada={b.id === nova}
            navegar={navegar}
            recarregar={recarregar}
            editar={() => editar(b)}
            duplicar={() => duplicar(b)}
          />
        ))}
      </div>
    </div>
  );
}

function CardBusca({ busca: b, recemCriada, navegar, recarregar, editar, duplicar }: {
  busca: Busca;
  recemCriada: boolean;
  navegar: Navegar;
  recarregar: () => Promise<void>;
  editar: () => void;
  duplicar: () => void;
}) {
  const { progresso, executar } = useExecucoes();
  const avisar = useAviso();
  const [arquivando, setArquivando] = useState(false);
  const [destaque, setDestaque] = useState(recemCriada);

  useEffect(() => {
    if (!recemCriada) return;
    const t = setTimeout(() => setDestaque(false), 6000);
    return () => clearTimeout(t);
  }, [recemCriada]);

  // Progresso local (esta aba disparou) ou do servidor (busca rodando em segundo plano)
  const local = progresso[b.id];
  const p: Progresso | null = local ?? (b.buscando
    ? { tipo: "sourcing", feito: b.buscando.inseridos, total: b.buscando.meta, texto: `Buscando… ${b.buscando.inseridos} de ${b.buscando.meta} empresas` }
    : null);
  const ocupado = !!p;

  const arquivar = async () => {
    if (!confirm(`Arquivar a busca "${b.nome}"? As empresas encontradas continuam no sistema.`)) return;
    setArquivando(true);
    try {
      await api(`/api/prospeccao/segmentos/${b.id}`, { method: "DELETE" });
      avisar(`Busca "${b.nome}" arquivada.`);
      await recarregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setArquivando(false);
    }
  };

  // Próximo passo contextual
  let proximo: { label: string; icon: React.ReactNode; onClick: () => void };
  if (b.total === 0) {
    proximo = { label: "Buscar empresas", icon: <Search className="w-4 h-4" />, onClick: () => void executar(b.id, "sourcing", b.nome) };
  } else if (b.etapas.qualificar > 0) {
    proximo = { label: `Qualificar ${fmtNum(b.etapas.qualificar)}`, icon: <Sparkles className="w-4 h-4" />, onClick: () => void executar(b.id, "pipeline", b.nome) };
  } else if (b.etapas.revisar > 0) {
    proximo = { label: `Revisar ${fmtNum(b.etapas.revisar)}`, icon: <ClipboardCheck className="w-4 h-4" />, onClick: () => navegar("revisao", { segmentId: b.id }) };
  } else if (b.etapas.abordar > 0) {
    proximo = { label: "Ir para disparo", icon: <Send className="w-4 h-4" />, onClick: () => navegar("disparo") };
  } else {
    proximo = { label: "Buscar mais empresas", icon: <RefreshCw className="w-4 h-4" />, onClick: () => void executar(b.id, "sourcing", b.nome) };
  }

  const termos = [b.termoBusca, ...b.termosSecundarios];

  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 transition-shadow ${
      destaque ? "border-primary shadow-[0_0_0_3px] shadow-primary/20" : "border-border"
    }`}>
      {/* Cabeçalho */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{b.nome}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1" title={termos.join(", ")}>
            {termos.slice(0, 3).join(" · ")}{termos.length > 3 ? ` +${termos.length - 3}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/10" aria-label="Mais ações">
              {arquivando ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navegar("empresas", { segmentId: b.id })}>
              <Building2 className="w-4 h-4 mr-2" /> Ver empresas
            </DropdownMenuItem>
            <DropdownMenuItem disabled={ocupado} onClick={() => void executar(b.id, "sourcing", b.nome)}>
              <Search className="w-4 h-4 mr-2" /> Buscar mais empresas
            </DropdownMenuItem>
            <DropdownMenuItem disabled={ocupado || b.etapas.qualificar === 0} onClick={() => void executar(b.id, "pipeline", b.nome)}>
              <Sparkles className="w-4 h-4 mr-2" /> Qualificar pendentes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={editar}><Pencil className="w-4 h-4 mr-2" /> Editar busca</DropdownMenuItem>
            <DropdownMenuItem onClick={duplicar}><Copy className="w-4 h-4 mr-2" /> Duplicar</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={ocupado} onClick={() => void arquivar()} className="text-red-600 focus:text-red-600">
              <Archive className="w-4 h-4 mr-2" /> Arquivar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[16rem]" title={b.cidades.join(", ")}>
            {b.cidades.slice(0, 3).join(", ")}{b.cidades.length > 3 ? ` +${b.cidades.length - 3}` : ""}
          </span>
        </span>
        <span className="flex items-center gap-1"><Search className="w-3 h-3" /> meta {fmtNum(b.metaEmpresas)}</span>
        {b.apenasCelular && <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" /> só celular</span>}
        {b.filtroSite !== "TODOS" && (
          <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {b.filtroSite === "SEM_SITE" ? "sem site" : "com site"}</span>
        )}
      </div>

      {/* Progresso do funil desta busca */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <button onClick={() => navegar("empresas", { segmentId: b.id })} className="text-sm font-semibold text-foreground hover:text-primary">
            {fmtNum(b.total)} empresas
          </button>
          <span className="text-[11px] text-muted-foreground">
            {b.total > 0 ? `${fmtNum(b.etapas.abordar + b.etapas.conversando + b.etapas.ganhos)} aprovadas ou abordadas` : "nenhuma ainda"}
          </span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
          {b.total > 0 && SEGMENTOS_BARRA.map((s) => {
            const n = b.etapas[s.id];
            return n > 0 ? <div key={s.id} className={s.cor} style={{ width: `${(n / b.total) * 100}%` }} title={`${s.label}: ${n}`} /> : null;
          })}
        </div>
        {b.total > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {SEGMENTOS_BARRA.map((s) => {
              const n = b.etapas[s.id];
              if (!n) return null;
              return (
                <span key={s.id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={`w-2 h-2 rounded-full ${s.cor}`} /> {s.label} {fmtNum(n)}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Execução em andamento */}
      {p && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> {p.texto}
          </div>
          {p.total > 0 && (
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (p.feito / p.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-2 mt-auto pt-1">
        <button onClick={proximo.onClick} disabled={ocupado} className={`${btn.primario} flex-1`}>
          {proximo.icon} {proximo.label}
        </button>
        <button onClick={() => navegar("empresas", { segmentId: b.id })} className={btn.secundario} title="Ver empresas">
          <Building2 className="w-4 h-4" />
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
