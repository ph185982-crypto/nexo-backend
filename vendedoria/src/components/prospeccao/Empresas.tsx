"use client";

// Empresas: todas as empresas prospectadas, com filtros, seleção em massa e
// detalhe lateral.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, X, CheckCircle2, XCircle, RotateCcw, ClipboardCheck, ChevronLeft, ChevronRight,
  Building2, Smartphone, Phone, Star, Loader2, Filter, Globe,
} from "lucide-react";
import { ETAPAS, STATUS_PROSPECT, infoStatus, type AcaoManual } from "@/lib/prospeccao/status";
import { api, fmtNum, fmtTelefone, type Busca, type EmpresaResumo } from "./api";
import { Carregando, EmptyState, ScorePill, StatusBadge, btn, inputCls, useAviso } from "./ui";
import { LeadDrawer } from "./LeadDrawer";

interface Filtros {
  q: string;
  segmentId: string;
  etapa: string;
  status: string;
  tipoTelefone: string;
  scoreMin: string;
  site: string;
  ordem: string;
}

const FILTROS_VAZIOS: Filtros = { q: "", segmentId: "", etapa: "", status: "", tipoTelefone: "", scoreMin: "", site: "", ordem: "score" };

const ACOES_MASSA: Array<{ acao: AcaoManual; label: string; icon: React.ReactNode; cls: string }> = [
  { acao: "aprovar",     label: "Aprovar",            icon: <CheckCircle2 className="w-4 h-4" />, cls: btn.sucesso },
  { acao: "descartar",   label: "Descartar",          icon: <XCircle className="w-4 h-4" />,      cls: btn.perigo },
  { acao: "revisar",     label: "Mandar p/ revisão",  icon: <ClipboardCheck className="w-4 h-4" />, cls: btn.secundario },
  { acao: "reprocessar", label: "Requalificar",       icon: <RotateCcw className="w-4 h-4" />,    cls: btn.secundario },
];

export function Empresas({ orgId, buscas, filtrosIniciais, aoMudar }: {
  orgId: string;
  buscas: Busca[];
  filtrosIniciais: Record<string, string>;
  aoMudar: () => void;
}) {
  const avisar = useAviso();
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    ...FILTROS_VAZIOS,
    ...Object.fromEntries(Object.entries(filtrosIniciais).filter(([k]) => k in FILTROS_VAZIOS)),
  }));
  const [qDigitado, setQDigitado] = useState(filtros.q);
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<{ empresas: EmpresaResumo[]; total: number; pageSize: number } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [executando, setExecutando] = useState<AcaoManual | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  // Debounce da busca textual
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.q === qDigitado ? f : { ...f, q: qDigitado })), 350);
    return () => clearTimeout(t);
  }, [qDigitado]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ orgId, page: String(page) });
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
    return p.toString();
  }, [orgId, page, filtros]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await api(`/api/prospeccao/empresas?${query}`));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setCarregando(false);
    }
  }, [query, avisar]);

  useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (k: keyof Filtros, v: string) => {
    setFiltros((f) => ({ ...f, [k]: v, ...(k === "etapa" ? { status: "" } : k === "status" ? { etapa: "" } : {}) }));
    setPage(1);
    setSelecao(new Set());
  };

  const limpar = () => { setFiltros(FILTROS_VAZIOS); setQDigitado(""); setPage(1); setSelecao(new Set()); };
  const ativos = Object.entries(filtros).filter(([k, v]) => v && k !== "ordem" && k !== "q").length + (filtros.q ? 1 : 0);

  const empresas = dados?.empresas ?? [];
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.pageSize)) : 1;
  const todosSelecionados = empresas.length > 0 && empresas.every((e) => selecao.has(e.id));

  const alternar = (id: string) => setSelecao((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const alternarTodos = () => setSelecao(todosSelecionados ? new Set() : new Set(empresas.map((e) => e.id)));

  const acaoEmMassa = async (acao: AcaoManual) => {
    setExecutando(acao);
    try {
      const r = await api<{ alterados: number; ignorados: number }>("/api/prospeccao/empresas/acoes", {
        method: "POST",
        json: { ids: [...selecao], acao },
      });
      avisar(`${r.alterados} empresa(s) atualizada(s)${r.ignorados ? ` · ${r.ignorados} ignorada(s) por estarem em outra etapa` : ""}.`);
      setSelecao(new Set());
      await carregar();
      aoMudar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setExecutando(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Barra de filtros */}
      <div className="px-4 md:px-6 py-3 border-b border-border bg-card space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={qDigitado}
              onChange={(e) => { setQDigitado(e.target.value); setPage(1); }}
              placeholder="Buscar por nome, telefone ou endereço"
              className={`${inputCls} pl-9`}
            />
          </div>
          <button onClick={() => setFiltrosAbertos((v) => !v)} className={`${btn.secundario} md:hidden`}>
            <Filter className="w-4 h-4" /> {ativos > 0 && <span className="text-xs">{ativos}</span>}
          </button>
          <select value={filtros.ordem} onChange={(e) => mudar("ordem", e.target.value)} className="hidden md:block rounded-lg border border-border bg-background text-foreground px-2 py-2 text-sm outline-none focus:border-primary" aria-label="Ordenar">
            <option value="score">Maior score</option>
            <option value="recentes">Mais recentes</option>
            <option value="atualizados">Atualizadas recentemente</option>
            <option value="avaliacao">Melhor nota no Google</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        </div>
        <div className={`${filtrosAbertos ? "grid" : "hidden"} md:flex grid-cols-2 gap-2 md:flex-wrap md:items-center`}>
          <Sel value={filtros.segmentId} onChange={(v) => mudar("segmentId", v)} label="Todas as buscas">
            {buscas.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </Sel>
          <Sel value={filtros.etapa} onChange={(v) => mudar("etapa", v)} label="Todas as etapas">
            {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            <option value="encerrado">Descartadas / perdidas</option>
          </Sel>
          <Sel value={filtros.status} onChange={(v) => mudar("status", v)} label="Qualquer status">
            {STATUS_PROSPECT.map((s) => <option key={s} value={s}>{infoStatus(s).label}</option>)}
          </Sel>
          <Sel value={filtros.tipoTelefone} onChange={(v) => mudar("tipoTelefone", v)} label="Qualquer telefone">
            <option value="CELULAR">WhatsApp (celular)</option>
            <option value="FIXO">Fixo</option>
          </Sel>
          <Sel value={filtros.site} onChange={(v) => mudar("site", v)} label="Com ou sem site">
            <option value="sem">Sem site</option>
            <option value="com">Com site</option>
          </Sel>
          <Sel value={filtros.scoreMin} onChange={(v) => mudar("scoreMin", v)} label="Qualquer score">
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Score ≥ {n}</option>)}
          </Sel>
          <div className="md:hidden">
            <Sel value={filtros.ordem} onChange={(v) => mudar("ordem", v)} label="">
              <option value="score">Maior score</option>
              <option value="recentes">Mais recentes</option>
              <option value="nome">Nome (A–Z)</option>
            </Sel>
          </div>
          {ativos > 0 && (
            <button onClick={limpar} className={btn.fantasma}><X className="w-3.5 h-3.5" /> Limpar filtros</button>
          )}
        </div>
      </div>

      {/* Ações em massa */}
      {selecao.size > 0 && (
        <div className="px-4 md:px-6 py-2 border-b border-border bg-primary/5 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground mr-1">{selecao.size} selecionada(s)</span>
          {ACOES_MASSA.map((a) => (
            <button key={a.acao} onClick={() => void acaoEmMassa(a.acao)} disabled={!!executando} className={`${a.cls} !py-1.5 !text-xs`}>
              {executando === a.acao ? <Loader2 className="w-4 h-4 animate-spin" /> : a.icon}
              {a.label}
            </button>
          ))}
          <button onClick={() => setSelecao(new Set())} className={`${btn.fantasma} ml-auto`}>Cancelar</button>
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-auto">
        {!dados ? (
          <Carregando />
        ) : empresas.length === 0 ? (
          <EmptyState
            icon={<Building2 className="w-6 h-6" />}
            titulo={ativos ? "Nenhuma empresa com esses filtros" : "Nenhuma empresa ainda"}
            descricao={ativos ? "Tente remover alguns filtros." : "Crie uma busca e rode-a para encontrar empresas."}
            acao={ativos ? <button onClick={limpar} className={btn.secundario}>Limpar filtros</button> : undefined}
          />
        ) : (
          <>
            {/* Tabela (desktop) */}
            <table className="hidden md:table w-full text-sm">
              <thead className="sticky top-0 bg-card z-10 border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="w-10 pl-6 py-2 text-left">
                    <input type="checkbox" checked={todosSelecionados} onChange={alternarTodos} aria-label="Selecionar todas" className="w-4 h-4" />
                  </th>
                  <th className="py-2 text-left font-medium">Empresa</th>
                  <th className="py-2 text-left font-medium">Contato</th>
                  <th className="py-2 text-left font-medium">Sinais</th>
                  <th className="py-2 text-center font-medium">Score</th>
                  <th className="py-2 pr-6 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-border ${carregando ? "opacity-60" : ""}`}>
                {empresas.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setAberta(e.id)}
                    className={`cursor-pointer hover:bg-accent/5 ${selecao.has(e.id) ? "bg-primary/5" : ""}`}
                  >
                    <td className="pl-6 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={selecao.has(e.id)} onChange={() => alternar(e.id)} aria-label={`Selecionar ${e.nome ?? ""}`} className="w-4 h-4" />
                    </td>
                    <td className="py-2.5 pr-3 max-w-xs">
                      <p className="font-medium text-foreground truncate">{e.nome ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.segment?.nome ?? "Importada"}
                        {e.ratingGoogle != null && <> · <Star className="inline w-3 h-3 -mt-0.5 text-yellow-500 fill-yellow-500" /> {e.ratingGoogle.toFixed(1)} ({e.numeroAvaliacoes ?? 0})</>}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-xs text-foreground">
                        {e.tipoTelefone === "CELULAR" ? <Smartphone className="w-3.5 h-3.5 text-green-500" /> : <Phone className="w-3.5 h-3.5 text-muted-foreground" />}
                        {fmtTelefone(e.telefone)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <SinaisCompactos e={e} />
                    </td>
                    <td className="py-2.5 text-center"><ScorePill score={e.score} /></td>
                    <td className="py-2.5 pr-6"><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards (mobile) */}
            <ul className={`md:hidden divide-y divide-border ${carregando ? "opacity-60" : ""}`}>
              {empresas.map((e) => (
                <li key={e.id} className={`flex items-start gap-3 px-4 py-3 ${selecao.has(e.id) ? "bg-primary/5" : ""}`}>
                  <input type="checkbox" checked={selecao.has(e.id)} onChange={() => alternar(e.id)} className="w-4 h-4 mt-1" aria-label={`Selecionar ${e.nome ?? ""}`} />
                  <button onClick={() => setAberta(e.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-foreground truncate">{e.nome ?? "—"}</p>
                      <ScorePill score={e.score} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtTelefone(e.telefone)} · {e.segment?.nome ?? "Importada"}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <StatusBadge status={e.status} />
                      <SinaisCompactos e={e} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Paginação */}
      {dados && dados.total > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-2 border-t border-border bg-card text-xs text-muted-foreground">
          <span>{fmtNum(dados.total)} empresa(s)</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={btn.fantasma} aria-label="Página anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>{page} / {totalPaginas}</span>
            <button onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas} className={btn.fantasma} aria-label="Próxima página">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {aberta && (
        <LeadDrawer
          id={aberta}
          onClose={() => setAberta(null)}
          onMudou={() => { void carregar(); aoMudar(); }}
        />
      )}
    </div>
  );
}

function Sel({ value, onChange, label, children }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border bg-background text-foreground px-2 py-1.5 text-xs outline-none focus:border-primary w-full md:w-auto ${
        value ? "border-primary/60" : "border-border"
      }`}
    >
      {label && <option value="">{label}</option>}
      {children}
    </select>
  );
}

function SinaisCompactos({ e }: { e: EmpresaResumo }) {
  const item = (v: boolean | null, rotulo: string, icon: React.ReactNode) => (
    <span
      title={`${rotulo}: ${v === null ? "não verificado" : v ? "sim" : "não"}`}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md border ${
        v === true ? "border-green-500/30 text-green-600 dark:text-green-400"
          : v === false ? "border-red-500/30 text-red-500" : "border-border text-muted-foreground/50"
      }`}
    >
      {icon}
    </span>
  );
  return (
    <span className="inline-flex gap-1">
      {item(e.temSite ?? (e.website ? true : null), "Site", <Globe className="w-3 h-3" />)}
      {item(e.temAnuncioAtivo, "Anúncio ativo", <span className="text-[9px] font-bold">AD</span>)}
      {item(e.instagramAtivo, "Instagram ativo", <span className="text-[9px] font-bold">IG</span>)}
    </span>
  );
}
