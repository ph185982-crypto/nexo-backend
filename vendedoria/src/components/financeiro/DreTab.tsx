"use client";

// Aba DRE do financeiro: demonstração do resultado em regime de caixa, com
// análise vertical (% da receita líquida), horizontal (vs período anterior),
// 12 meses de evolução, acumulado do ano, leitura automática em frases e o
// editor de classificação das categorias. Só lê os lançamentos — nada muda.

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, ChevronDown, ChevronRight, Download, RotateCcw, Sparkles, SlidersHorizontal, Info, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from "recharts";
import { BRL } from "./receitas-shared";
import { FiltroPeriodo, Seg, filtroInicial, filtroParaQuery, type EscopoFiltro, type FiltroFin } from "./FiltroPeriodo";
import { VariacaoBadge } from "./OverviewTab";
import {
  ESTRUTURA_DRE, GRUPOS_DRE, analiseVertical, variacaoPct, dreParaCsv, grupoInfo, gruposDoTipo, labelMesCurto,
  type CategoriasPorGrupo, type Dre, type GrupoDre, type ItemClassificacao, type PontoSerie, type RelatorioDre,
} from "@/lib/finance/dre";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--foreground))",
} as const;
const CORES = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#64748b", "#a855f7"];
const CHAVE_ESCOPO = "financeiro.dre.escopo";
const TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 } as const;

type Modo = "realizado" | "projetado";

const fmtPct = (p: number | null | undefined) => (p == null ? "—" : `${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const kBRL = (v: number) => `R$${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;

function escopoSalvo(): EscopoFiltro {
  try {
    const v = localStorage.getItem(CHAVE_ESCOPO);
    if (v === "todos" || v === "nexo" || v === "pessoal") return v;
  } catch { /* sem storage */ }
  return "nexo";
}

function salvarEscopo(e: EscopoFiltro) {
  try { localStorage.setItem(CHAVE_ESCOPO, e); } catch { /* sem storage */ }
}

function baixarCsv(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DreTab() {
  // A DRE é da empresa por padrão (escopo Nexo); a escolha fica guardada no navegador.
  const [filtro, setFiltroState] = useState<FiltroFin>(() => ({ ...filtroInicial(), escopo: "nexo" }));
  const [pronto, setPronto] = useState(false);
  const [modo, setModo] = useState<Modo>("realizado");
  const [data, setData] = useState<RelatorioDre | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    setFiltroState((f) => ({ ...f, escopo: escopoSalvo() }));
    setPronto(true);
  }, []);

  const setFiltro = (f: FiltroFin) => {
    salvarEscopo(f.escopo);
    setFiltroState(f);
  };

  const carregar = useCallback(async () => {
    if (!pronto) return;
    setLoading(true);
    setErro(false);
    try {
      const r = await fetch(`/api/financeiro/dre?${filtroParaQuery(filtro)}`);
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
    }
  }, [filtro, pronto]);

  useEffect(() => { void carregar(); }, [carregar]);

  const classificarCategoria = async (item: ItemClassificacao, grupo: GrupoDre | null) => {
    setOcupado(item.chave);
    try {
      const r = await fetch("/api/financeiro/dre/classificacao", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: item.tipo, categoria: item.categoria, grupo }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setAviso(j.error ?? "Não foi possível salvar a classificação.");
        return;
      }
      setAviso(grupo ? `"${item.categoria}" agora entra em ${grupoInfo(grupo).label}.` : `"${item.categoria}" voltou para a classificação padrão.`);
      await carregar();
    } catch {
      setAviso("Sem conexão com o servidor.");
    } finally {
      setOcupado(null);
    }
  };

  if (!data && (loading || !pronto)) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!data || erro) {
    return <p className="text-center text-muted-foreground py-12">Não foi possível carregar a DRE.</p>;
  }

  const projetado = modo === "projetado";
  const dre = projetado ? data.projetado.atual : data.realizado.atual;
  const porGrupo = projetado ? data.projetado.porGrupo : data.realizado.porGrupo;
  const ant = data.realizado.anterior;
  const rotAnt = data.anterior.label;
  const escopoNome = data.escopo === "nexo" ? "Nexo (empresa)" : data.escopo === "pessoal" ? "Pessoal" : "Nexo + Pessoal + outros";
  const prev = data.projetado.previsto;
  const temPrevisto = prev.receitas > 0 || prev.despesas > 0;
  const manuais = data.classificacao.filter((c) => c.origem === "manual").length;

  const exportar = () => {
    const nome = `dre-${data.escopo}-${data.periodo.mes ?? `${data.periodo.de}_${data.periodo.ate}`}${projetado ? "-projetada" : ""}.csv`;
    baixarCsv(nome, dreParaCsv({
      titulo: `DRE ${projetado ? "projetada" : "realizada"} — ${escopoNome} — ${data.periodo.label}`,
      periodoLabel: data.periodo.label,
      anteriorLabel: rotAnt,
      atual: dre,
      anterior: ant,
      porGrupo,
    }));
  };

  const varOuNada = (campo: keyof Pick<Dre, "receitaLiquida" | "lucroBruto" | "resultadoOperacional" | "resultadoLiquido">) =>
    projetado ? undefined : variacaoPct(dre[campo], ant[campo]);

  return (
    <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
      {/* Cabeçalho + filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-foreground">DRE — {data.periodo.label}</h2>
          {data.competencia.ehMesAtual && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Competência atual</span>
          )}
          <span className="text-xs text-muted-foreground">Comparando com {rotAnt} · {escopoNome}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FiltroPeriodo filtro={filtro} onChange={setFiltro} />
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              ariaLabel="Modo da DRE"
              valor={modo}
              onChange={setModo}
              opcoes={[
                { v: "realizado" as Modo, label: "Realizado" },
                { v: "projetado" as Modo, label: "Projetado" },
              ]}
            />
            <Button variant="outline" size="sm" onClick={exportar} className="gap-1.5">
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>
        {projetado && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {temPrevisto
              ? <span>Projetado = realizado + {BRL.format(prev.receitas)} a receber ({prev.receitasQtd}) e {BRL.format(prev.despesas)} a pagar ({prev.despesasQtd}) com vencimento no período. A comparação com o período anterior fica de fora neste modo.</span>
              : <span>Nada previsto para este período — a projeção é igual ao realizado.</span>}
          </p>
        )}
      </div>

      {aviso && (
        <div role="status" className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-muted-foreground">×</button>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard titulo="Receita líquida" valor={dre.receitaLiquida} pct={varOuNada("receitaLiquida")} rot={rotAnt} />
        <KpiCard titulo="Lucro bruto" valor={dre.lucroBruto} margem={dre.margemBruta} pct={varOuNada("lucroBruto")} rot={rotAnt} />
        <KpiCard titulo="Resultado operacional" valor={dre.resultadoOperacional} margem={dre.margemOperacional} pct={varOuNada("resultadoOperacional")} rot={rotAnt} />
        <KpiCard titulo="Resultado líquido" valor={dre.resultadoLiquido} margem={dre.margemLiquida} pct={varOuNada("resultadoLiquido")} rot={rotAnt} destaque />
      </div>

      {/* Demonstração + leitura */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Demonstração do resultado — {projetado ? "projetada" : "realizada"}</CardTitle>
            <p className="text-xs text-muted-foreground">Clique numa linha para abrir as categorias que a compõem.</p>
          </CardHeader>
          <CardContent>
            <TabelaDre dre={dre} anterior={ant} porGrupo={porGrupo} rotAtual={data.periodo.label} rotAnt={rotAnt} comparar={!projetado} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Leitura do período</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data.insights.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-foreground/90">{t}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <AcumuladoCard a={data.acumuladoAno} />
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Receita líquida × saídas × resultado (últimos meses)</CardTitle></CardHeader>
          <CardContent><GraficoEvolucao serie={data.serie} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Para onde vai o dinheiro — {data.periodo.label}</CardTitle></CardHeader>
          <CardContent><GraficoSaidas dre={dre} /></CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base">Margens (% da receita líquida)</CardTitle></CardHeader>
          <CardContent><GraficoMargens serie={data.serie} /></CardContent>
        </Card>
      </div>

      <ClassificacaoCard itens={data.classificacao} manuais={manuais} ocupado={ocupado} onChange={classificarCategoria} />

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Como ler: regime de caixa — entram só as entradas e saídas confirmadas no extrato, agrupadas pela categoria de cada lançamento.
          AV % é a participação sobre a receita líquida; Var. % compara com {rotAnt}. No modo Projetado somam-se as receitas previstas em
          aberto e as contas a pagar pendentes do período. Esta aba não altera nenhum lançamento.
        </span>
      </p>
    </div>
  );
}

function KpiCard({ titulo, valor, margem, pct, rot, destaque }: {
  titulo: string; valor: number; margem?: number | null; pct?: number | null; rot: string; destaque?: boolean;
}) {
  const neg = valor < 0;
  return (
    <Card className={cn(destaque && (neg ? "border-red-500/40" : "border-primary/40"))}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={cn("text-xl font-bold truncate", neg ? "text-red-500" : "text-foreground")}>{BRL.format(valor)}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-[1rem]">
          {margem !== undefined && <span className="text-xs text-muted-foreground">margem {fmtPct(margem)}</span>}
          {pct !== undefined && <VariacaoBadge pct={pct} rotulo={rot} />}
        </div>
      </CardContent>
    </Card>
  );
}

function VariacaoCel({ pct, inv }: { pct: number | null; inv: boolean }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">—</span>;
  const flat = pct === 0;
  const up = pct > 0;
  const bom = flat ? null : inv ? !up : up;
  return (
    <span className={cn("text-xs font-medium tabular-nums", flat ? "text-muted-foreground" : bom ? "text-green-500" : "text-red-500")}>
      {up ? "+" : ""}{pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

function TabelaDre({ dre, anterior, porGrupo, rotAtual, rotAnt, comparar }: {
  dre: Dre; anterior: Dre; porGrupo: CategoriasPorGrupo; rotAtual: string; rotAnt: string; comparar: boolean;
}) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const cols = comparar ? 5 : 3;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 font-medium">Linha</th>
            <th className="text-right py-2 font-medium">{rotAtual}</th>
            <th className="text-right py-2 pl-3 font-medium" title="Análise vertical: participação sobre a receita líquida">AV %</th>
            {comparar && (
              <>
                <th className="text-right py-2 pl-3 font-medium">{rotAnt}</th>
                <th className="text-right py-2 pl-3 font-medium" title="Análise horizontal: variação sobre o período anterior">Var. %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {ESTRUTURA_DRE.map((l) => {
            const v = dre[l.campo];
            const a = anterior[l.campo];
            const av = analiseVertical(v, dre.receitaLiquida);
            const aberto = abertos.has(l.campo);
            const temDetalhe = !!l.grupos && l.grupos.some((g) => porGrupo[g].length > 0);
            const total = l.nivel === "total";
            const margem = l.margem ? dre[l.margem] : undefined;
            return (
              <React.Fragment key={l.campo}>
                <tr className={cn("border-b border-border", total && "bg-muted/40")}>
                  <td className={cn("py-2 pr-2", total ? "font-semibold text-foreground" : l.nivel === "subtotal" ? "font-medium text-foreground" : "text-muted-foreground")}>
                    <button
                      type="button"
                      disabled={!temDetalhe}
                      onClick={() => toggle(l.campo)}
                      aria-expanded={l.grupos ? aberto : undefined}
                      className={cn("inline-flex items-center gap-1.5 text-left", temDetalhe && "hover:text-foreground")}
                    >
                      {l.grupos
                        ? (aberto ? <ChevronDown className={cn("w-3.5 h-3.5 shrink-0", !temDetalhe && "opacity-30")} /> : <ChevronRight className={cn("w-3.5 h-3.5 shrink-0", !temDetalhe && "opacity-30")} />)
                        : <span className="w-3.5 shrink-0" />}
                      <span>
                        {l.prefixo && <span className="text-muted-foreground mr-1">{l.prefixo}</span>}
                        {l.label}
                      </span>
                    </button>
                    {margem !== undefined && margem !== null && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">margem {fmtPct(margem)}</span>
                    )}
                  </td>
                  <td className={cn("py-2 text-right tabular-nums", total ? (v < 0 ? "font-semibold text-red-500" : "font-semibold text-foreground") : "text-foreground")}>
                    {BRL.format(v)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">{fmtPct(av)}</td>
                  {comparar && (
                    <>
                      <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">{BRL.format(a)}</td>
                      <td className="py-2 pl-3 text-right"><VariacaoCel pct={variacaoPct(v, a)} inv={l.saida} /></td>
                    </>
                  )}
                </tr>

                {aberto && l.grupos && l.grupos.map((g) => {
                  const varios = l.grupos!.length > 1;
                  const itens = porGrupo[g];
                  if (varios && itens.length === 0 && dre.grupos[g] === 0) return null;
                  return (
                    <React.Fragment key={g}>
                      {varios && (
                        <tr className="border-b border-border/60 bg-muted/20 text-xs">
                          <td className="py-1.5 pl-7 text-foreground">{grupoInfo(g).label}</td>
                          <td className="py-1.5 text-right tabular-nums text-foreground">{BRL.format(dre.grupos[g])}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">{fmtPct(analiseVertical(dre.grupos[g], dre.receitaLiquida))}</td>
                          {comparar && (
                            <>
                              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{BRL.format(anterior.grupos[g])}</td>
                              <td className="py-1.5 text-right"><VariacaoCel pct={variacaoPct(dre.grupos[g], anterior.grupos[g])} inv={l.saida} /></td>
                            </>
                          )}
                        </tr>
                      )}
                      {itens.map((it) => (
                        <tr key={`${g}|${it.categoria}|${it.previsto ? "p" : "r"}`} className="border-b border-border/40 text-xs">
                          <td className={cn("py-1 text-muted-foreground", varios ? "pl-11" : "pl-7")}>
                            {it.categoria}
                            {it.previsto && <Badge variant="warning" className="ml-1.5 text-[10px] py-0">previsto</Badge>}
                            <span className="ml-1.5 text-[10px] opacity-70">{it.quantidade} lanç.</span>
                          </td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">{BRL.format(it.total)}</td>
                          <td className="py-1 pl-3 text-right tabular-nums text-muted-foreground">{fmtPct(analiseVertical(it.total, dre.receitaLiquida))}</td>
                          {comparar && <td colSpan={2} />}
                        </tr>
                      ))}
                      {!varios && itens.length === 0 && (
                        <tr className="text-xs">
                          <td colSpan={cols} className="py-1 pl-7 text-muted-foreground italic">Nenhuma categoria neste grupo no período.</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tira os meses sem movimento do começo da série (mantém ao menos os 6 últimos). */
function semMesesVaziosNoInicio(serie: PontoSerie[]): PontoSerie[] {
  const primeiro = serie.findIndex((p) => p.receitaLiquida !== 0 || p.saidas !== 0);
  const inicio = primeiro < 0 ? serie.length - 6 : Math.min(primeiro, serie.length - 6);
  return serie.slice(Math.max(0, inicio));
}

function GraficoEvolucao({ serie: serieCompleta }: { serie: PontoSerie[] }) {
  const serie = semMesesVaziosNoInicio(serieCompleta);
  const dados = serie.map((p) => ({ mes: p.label, receita: p.receitaLiquida, saidas: p.saidas, resultado: p.resultadoLiquido }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="mes" tick={TICK} />
          <YAxis tick={TICK} tickFormatter={kBRL} width={64} />
          <Tooltip formatter={(value: number) => BRL.format(value)} contentStyle={TOOLTIP_STYLE} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Bar dataKey="receita" name="Receita líquida" fill="#22c55e" radius={[4, 4, 0, 0]} />
          <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="resultado" name="Resultado líquido" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficoMargens({ serie: serieCompleta }: { serie: PontoSerie[] }) {
  const serie = semMesesVaziosNoInicio(serieCompleta);
  const dados = serie.map((p) => ({ mes: p.label, bruta: p.margemBruta, operacional: p.margemOperacional, liquida: p.margemLiquida }));
  if (!dados.some((d) => d.bruta != null)) {
    return <p className="text-sm text-muted-foreground py-10 text-center">Sem receita nos últimos 12 meses — não há margem para mostrar.</p>;
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="mes" tick={TICK} />
          <YAxis tick={TICK} tickFormatter={(v: number) => `${v}%`} width={48} />
          <Tooltip formatter={(value: number) => fmtPct(value)} contentStyle={TOOLTIP_STYLE} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Line type="monotone" dataKey="bruta" name="Margem bruta" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="operacional" name="Margem operacional" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="liquida" name="Margem líquida" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficoSaidas({ dre }: { dre: Dre }) {
  const dados = GRUPOS_DRE
    .filter((g) => g.tipo === "despesa" && dre.grupos[g.key] > 0)
    .map((g) => ({ nome: g.label, valor: dre.grupos[g.key], av: analiseVertical(dre.grupos[g.key], dre.receitaLiquida) }))
    .sort((a, b) => b.valor - a.valor);
  if (dados.length === 0) return <p className="text-sm text-muted-foreground py-16 text-center">Sem saídas neste período.</p>;
  const totalSaidas = dados.reduce((a, d) => a + d.valor, 0);
  return (
    <div className="space-y-3">
      <div style={{ height: Math.max(180, dados.length * 34 + 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" margin={{ left: 4, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={TICK} tickFormatter={kBRL} />
            <YAxis type="category" dataKey="nome" width={150} tick={TICK} />
            <Tooltip formatter={(value: number) => BRL.format(value)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted))" }} />
            <Bar dataKey="valor" name="Saída" radius={[0, 4, 4, 0]}>
              {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 text-xs">
        {dados.slice(0, 4).map((d, i) => (
          <li key={d.nome} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CORES[i % CORES.length] }} />
              <span>{d.nome}</span>
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {Math.round((d.valor / totalSaidas) * 100)}% das saídas{d.av != null && <span className="text-muted-foreground"> · {fmtPct(d.av)} da receita</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AcumuladoCard({ a }: { a: RelatorioDre["acumuladoAno"] }) {
  const d = a.dre;
  const media = a.meses > 0 ? d.resultadoLiquido / a.meses : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Acumulado de {a.ano}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Janeiro a {labelMesCurto(a.ate)} · {a.meses} {a.meses === 1 ? "mês" : "meses"} com movimento
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <MiniValor label="Receita líquida" v={d.receitaLiquida} cor="text-green-500" />
        <MiniValor label="Saídas" v={d.totalSaidas} cor="text-red-500" />
        <MiniValor label="Resultado líquido" v={d.resultadoLiquido} cor={d.resultadoLiquido >= 0 ? "text-blue-500" : "text-red-500"} sub={`margem ${fmtPct(d.margemLiquida)}`} />
        <MiniValor label="Média por mês" v={media} cor={media >= 0 ? "text-foreground" : "text-red-500"} sub="resultado líquido" />
      </CardContent>
    </Card>
  );
}

function MiniValor({ label, v, cor, sub }: { label: string; v: number; cor: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-sm sm:text-base font-semibold truncate", cor)}>{BRL.format(v)}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const selectCls = "h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary";

function ClassificacaoCard({ itens, manuais, ocupado, onChange }: {
  itens: ItemClassificacao[];
  manuais: number;
  ocupado: string | null;
  onChange: (item: ItemClassificacao, grupo: GrupoDre | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const filtrados = termo ? itens.filter((i) => i.categoria.toLowerCase().includes(termo) || grupoInfo(i.grupo).label.toLowerCase().includes(termo)) : itens;

  return (
    <Card>
      <CardHeader className="pb-2">
        <button type="button" onClick={() => setAberto(!aberto)} className="w-full flex items-center justify-between gap-2 text-left" aria-expanded={aberto}>
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            Em que linha cada categoria entra
            <span className="text-xs font-normal text-muted-foreground">({itens.length} categorias{manuais > 0 ? `, ${manuais} ajustada${manuais > 1 ? "s" : ""} à mão` : ""})</span>
          </CardTitle>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", !aberto && "-rotate-90")} />
        </button>
      </CardHeader>
      {aberto && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Por padrão a categoria cai no grupo pela palavra-chave (ex.: &quot;Assinaturas&quot; → Tecnologia). Se alguma estiver no lugar errado,
            troque aqui: a DRE recalcula na hora e nenhum lançamento muda.
          </p>
          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar categoria ou grupo"
              aria-label="Buscar categoria"
              className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-medium">Tipo</th>
                  <th className="text-left py-2 font-medium">Categoria</th>
                  <th className="text-right py-2 font-medium">Lanç.</th>
                  <th className="text-right py-2 font-medium">Total (sempre)</th>
                  <th className="text-left py-2 pl-4 font-medium">Linha da DRE</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((it) => {
                  const salvando = ocupado === it.chave;
                  return (
                    <tr key={`${it.tipo}|${it.chave}`} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5">
                        <Badge variant={it.tipo === "receita" ? "success" : "destructive"} className="text-[10px]">{it.tipo === "receita" ? "Receita" : "Despesa"}</Badge>
                      </td>
                      <td className="py-1.5 text-foreground">{it.categoria}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{it.quantidade}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{BRL.format(it.total)}</td>
                      <td className="py-1.5 pl-4">
                        <select
                          className={selectCls}
                          value={it.grupo}
                          disabled={salvando}
                          aria-label={`Linha da DRE para ${it.categoria}`}
                          onChange={(e) => onChange(it, e.target.value as GrupoDre)}
                        >
                          {gruposDoTipo(it.tipo).map((g) => (
                            <option key={g.key} value={g.key}>{g.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {salvando ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin inline text-muted-foreground" />
                        ) : it.origem === "manual" ? (
                          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => onChange(it, null)} title="Voltar para a classificação padrão">
                            <RotateCcw className="w-3 h-3" /> Padrão
                          </Button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">padrão</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtrados.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-sm text-muted-foreground">Nenhuma categoria encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
