"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, TrendingUp, TrendingDown, DollarSign, ArrowUp, ArrowDown, CalendarClock,
  Building2, User, CheckCircle2, ThumbsDown, Undo2, AlertTriangle, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  BRL, fmtData, ParcelaChip, PerdaDialog, executarAcaoReceita, type ReceitaItem,
} from "./receitas-shared";
import { FiltroPeriodo, filtroInicial, filtroParaQuery, type FiltroFin } from "./FiltroPeriodo";

const DONUT_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4"];

interface Comparativo { atual: number; anterior: number; variacaoPct: number | null }

interface Bloco {
  receitas: number;
  despesas: number;
  saldo: number;
  anterior: { receitas: number; despesas: number; saldo: number };
  variacao: { receitas: number | null; despesas: number | null; saldo: number | null };
  previsto: { abertas: number; recebidas: number; perdidas: number };
}

interface PrevistaItem extends ReceitaItem { motivo_perda?: string | null }

interface OverviewData {
  periodo: { tipo: "mes" | "dia" | "intervalo"; mes: string | null; de: string; ate: string; label: string };
  competencia: { mesAtual: string; hoje: string; ehMesAtual: boolean };
  escopo: "todos" | "nexo" | "pessoal";
  receitas: number;
  despesas: number;
  saldo: number;
  meta: { alvo: number; atual: number } | null;
  categorias: Array<{ categoria: string; total: number }>;
  mensal: Array<{ mes: string; receitas: number; despesas: number }>;
  comparativo: {
    periodoAnterior: { tipo: string; mes: string | null; label: string };
    receitas: Comparativo;
    despesas: Comparativo;
    saldo: Comparativo;
  };
  porNegocio: { nexo: Bloco; pessoal: Bloco; outros: Bloco };
  receitasPrevistas: {
    total: number;
    quantidade: number;
    recebido: number;
    recebidoQuantidade: number;
    itens: PrevistaItem[];
    atrasadasAnteriores: { total: number; quantidade: number; itens: PrevistaItem[] };
    perdidas: { total: number; quantidade: number; itens: PrevistaItem[] };
  };
}

// Pra despesas, variação positiva (gastou mais) é ruim → inverte a cor.
function VariacaoBadge({ pct, rotulo, invertColor }: { pct: number | null | undefined; rotulo: string; invertColor?: boolean }) {
  if (pct == null) return null;
  const isUp = pct > 0;
  const isFlat = pct === 0;
  const good = isFlat ? null : invertColor ? !isUp : isUp;
  const color = isFlat ? "text-muted-foreground" : good ? "text-green-500" : "text-red-500";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", color)}>
      {!isFlat && (isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      {isFlat ? "0%" : `${Math.abs(pct).toLocaleString("pt-BR")}%`} vs {rotulo}
    </span>
  );
}

export function OverviewTab() {
  const [filtro, setFiltro] = useState<FiltroFin>(filtroInicial);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [perda, setPerda] = useState<ReceitaItem | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarAtrasadas, setMostrarAtrasadas] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(false);
    try {
      const r = await fetch(`/api/financeiro/overview?${filtroParaQuery(filtro)}`);
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => { void carregar(); }, [carregar]);

  const agir = async (id: string, acao: "confirmar" | "reverter_perda") => {
    setOcupado(id);
    const r = await executarAcaoReceita(id, acao);
    setOcupado(null);
    setAviso(r.ok ? (acao === "confirmar" ? "Recebimento confirmado e lançado no extrato." : "Perda desfeita.") : (r.erro ?? "Erro ao atualizar."));
    void carregar();
  };

  if (!data && loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!data || erro) {
    return <p className="text-center text-muted-foreground py-12">Não foi possível carregar os dados financeiros.</p>;
  }

  const rotAnt = data.comparativo.periodoAnterior.label;
  const escopoNome = data.escopo === "nexo" ? "Nexo" : data.escopo === "pessoal" ? "Pessoal" : "Nexo + Pessoal + outros";
  const metaPct = data.meta && data.meta.alvo > 0 ? Math.round((data.meta.atual / data.meta.alvo) * 100) : 0;
  const metaColor = metaPct >= 60 ? "bg-green-500" : metaPct >= 30 ? "bg-yellow-500" : "bg-red-500";
  const rp = data.receitasPrevistas;
  const outros = data.porNegocio.outros;
  const temOutros = outros.receitas + outros.despesas + outros.previsto.abertas > 0;
  const previstoTotal = rp.total + rp.recebido; // em aberto + já recebido (perdas ficam de fora)

  return (
    <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
      {/* Cabeçalho + filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-foreground">{data.periodo.label}</h2>
          {data.competencia.ehMesAtual && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Competência atual</span>
          )}
          <span className="text-xs text-muted-foreground">Comparando com {rotAnt} · {escopoNome}</span>
        </div>
        <FiltroPeriodo filtro={filtro} onChange={setFiltro} />
      </div>

      {aviso && (
        <div role="status" className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-muted-foreground">×</button>
        </div>
      )}

      {/* Resumo do escopo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ResumoCard titulo="Receitas" valor={data.receitas} cor="text-green-500" icone={<TrendingUp className="w-5 h-5 text-green-500" />} bg="bg-green-500/10"
          variacao={<VariacaoBadge pct={data.comparativo.receitas.variacaoPct} rotulo={rotAnt} />} />
        <ResumoCard titulo="Despesas" valor={data.despesas} cor="text-red-500" icone={<TrendingDown className="w-5 h-5 text-red-500" />} bg="bg-red-500/10"
          variacao={<VariacaoBadge pct={data.comparativo.despesas.variacaoPct} rotulo={rotAnt} invertColor />} />
        <ResumoCard titulo="Saldo" valor={data.saldo} cor={data.saldo >= 0 ? "text-blue-500" : "text-red-500"} icone={<DollarSign className={cn("w-5 h-5", data.saldo >= 0 ? "text-blue-500" : "text-red-500")} />} bg={data.saldo >= 0 ? "bg-blue-500/10" : "bg-red-500/10"}
          variacao={<VariacaoBadge pct={data.comparativo.saldo.variacaoPct} rotulo={rotAnt} />} />
      </div>

      {/* Nexo × Pessoal */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Nexo × Pessoal</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <BlocoCard
            titulo="Nexo (empresa)" icone={<Building2 className="w-4 h-4" />} b={data.porNegocio.nexo} rotAnt={rotAnt}
            ativo={data.escopo === "nexo"} onClick={() => setFiltro({ ...filtro, escopo: data.escopo === "nexo" ? "todos" : "nexo" })}
          />
          <BlocoCard
            titulo="Pessoal (meu)" icone={<User className="w-4 h-4" />} b={data.porNegocio.pessoal} rotAnt={rotAnt}
            ativo={data.escopo === "pessoal"} onClick={() => setFiltro({ ...filtro, escopo: data.escopo === "pessoal" ? "todos" : "pessoal" })}
          />
        </div>
        {temOutros && (
          <p className="text-xs text-muted-foreground">
            Outros negócios (LuKaizen / Geral): receitas {BRL.format(outros.receitas)} · despesas {BRL.format(outros.despesas)} — entram apenas em &quot;Tudo&quot;.
          </p>
        )}
      </div>

      {/* Comparativo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Comparativo: {data.periodo.label} × {rotAnt}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-medium" />
                <th className="text-right py-2 font-medium">{data.periodo.label}</th>
                <th className="text-right py-2 font-medium">{rotAnt}</th>
                <th className="text-right py-2 font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {([["Receitas", data.comparativo.receitas, false], ["Despesas", data.comparativo.despesas, true], ["Saldo", data.comparativo.saldo, false]] as const).map(([nome, c, inv]) => {
                const dif = Math.round((c.atual - c.anterior) * 100) / 100;
                const bom = dif === 0 ? null : inv ? dif < 0 : dif > 0;
                return (
                  <tr key={nome} className="border-b border-border last:border-0">
                    <td className="py-2 font-medium text-foreground">{nome}</td>
                    <td className="py-2 text-right text-foreground">{BRL.format(c.atual)}</td>
                    <td className="py-2 text-right text-muted-foreground">{BRL.format(c.anterior)}</td>
                    <td className={cn("py-2 text-right font-medium", bom == null ? "text-muted-foreground" : bom ? "text-green-500" : "text-red-500")}>
                      {dif > 0 ? "+" : ""}{BRL.format(dif)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Meta */}
      {data.meta && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Meta Mensal</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">{BRL.format(data.meta.atual)} de {BRL.format(data.meta.alvo)}</span>
              <span className="font-medium">{metaPct}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", metaColor)} style={{ width: `${Math.min(metaPct, 100)}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Receitas previstas do período */}
      <Card>
        <CardHeader className="pb-3 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-muted-foreground" />
            Receitas previstas — {data.periodo.label}
          </CardTitle>
          <div className="text-right">
            <span className="text-lg font-semibold text-green-500">{BRL.format(rp.total)}</span>
            <span className="block text-[11px] text-muted-foreground">a receber neste período</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(previstoTotal > 0 || rp.perdidas.quantidade > 0) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>Previsto: <strong className="text-foreground">{BRL.format(previstoTotal)}</strong></span>
              <span>Já recebido: <strong className="text-green-500">{BRL.format(rp.recebido)}</strong></span>
              <span>Falta: <strong className="text-orange-500">{BRL.format(rp.total)}</strong></span>
              {rp.perdidas.quantidade > 0 && <span>Perdido: <strong className="text-red-500">{BRL.format(rp.perdidas.total)}</strong></span>}
            </div>
          )}

          {rp.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Nenhuma receita em aberto neste período.</p>
          ) : (
            <div>
              {rp.itens.map((r) => (
                <LinhaPrevista key={r.id} r={r} ocupado={ocupado === r.id}
                  onReceber={() => void agir(r.id, "confirmar")} onPerda={() => setPerda(r)} />
              ))}
            </div>
          )}

          {rp.atrasadasAnteriores.quantidade > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5">
              <button onClick={() => setMostrarAtrasadas(!mostrarAtrasadas)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
                <span className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  {rp.atrasadasAnteriores.quantidade} receita(s) em aberto de períodos anteriores · {BRL.format(rp.atrasadasAnteriores.total)}
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform text-red-500", !mostrarAtrasadas && "-rotate-90")} />
              </button>
              {mostrarAtrasadas && (
                <div className="px-3 pb-2">
                  {rp.atrasadasAnteriores.itens.map((r) => (
                    <LinhaPrevista key={r.id} r={r} ocupado={ocupado === r.id}
                      onReceber={() => void agir(r.id, "confirmar")} onPerda={() => setPerda(r)} />
                  ))}
                  {rp.atrasadasAnteriores.quantidade > rp.atrasadasAnteriores.itens.length && (
                    <p className="text-xs text-muted-foreground pt-1">+{rp.atrasadasAnteriores.quantidade - rp.atrasadasAnteriores.itens.length} na aba Receitas</p>
                  )}
                </div>
              )}
            </div>
          )}

          {rp.perdidas.quantidade > 0 && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Perdas neste período ({rp.perdidas.quantidade})</p>
              {rp.perdidas.itens.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm py-1 border-b border-border last:border-0 opacity-70">
                  <div className="min-w-0">
                    <span className="line-through decoration-muted-foreground/50">{r.descricao}</span>
                    {r.cliente && <span className="text-muted-foreground"> — {r.cliente}</span>}
                    {r.motivo_perda && <span className="block text-xs text-muted-foreground">Motivo: {r.motivo_perda}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">{BRL.format(r.valor)}</span>
                    <Button variant="ghost" size="sm" disabled={ocupado === r.id} onClick={() => void agir(r.id, "reverter_perda")} className="gap-1">
                      <Undo2 className="w-3.5 h-3.5" /> Desfazer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Despesas por Categoria</CardTitle></CardHeader>
          <CardContent>
            {data.categorias.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">Sem despesas neste período.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.categorias} dataKey="total" nameKey="categoria" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                      {data.categorias.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => BRL.format(value)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                    <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Receitas vs Despesas (6 meses)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.mensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => BRL.format(value)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="receitas" name="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <PerdaDialog
        receita={perda}
        onClose={() => setPerda(null)}
        onDone={() => { setAviso("Perda registrada. A receita continua no histórico e pode ser desfeita."); void carregar(); }}
      />
    </div>
  );
}

function ResumoCard({ titulo, valor, cor, icone, bg, variacao }: {
  titulo: string; valor: number; cor: string; icone: React.ReactNode; bg: string; variacao: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{titulo}</p>
            <p className={cn("text-2xl font-bold", cor)}>{BRL.format(valor)}</p>
            {variacao}
          </div>
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", bg)}>{icone}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BlocoCard({ titulo, icone, b, rotAnt, ativo, onClick }: {
  titulo: string; icone: React.ReactNode; b: Bloco; rotAnt: string; ativo: boolean; onClick: () => void;
}) {
  return (
    <Card className={cn("transition-colors", ativo && "border-primary")}>
      <CardContent className="p-4 space-y-3">
        <button onClick={onClick} className="w-full flex items-center justify-between text-left" title="Filtrar a tela por este negócio">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">{icone}{titulo}</span>
          <span className="text-[11px] text-muted-foreground">{ativo ? "filtrando — clique p/ limpar" : "clique p/ filtrar"}</span>
        </button>
        <div className="grid grid-cols-3 gap-2">
          <Mini titulo="Receitas" v={b.receitas} cor="text-green-500" pct={b.variacao.receitas} rot={rotAnt} />
          <Mini titulo="Despesas" v={b.despesas} cor="text-red-500" pct={b.variacao.despesas} rot={rotAnt} inv />
          <Mini titulo="Saldo" v={b.saldo} cor={b.saldo >= 0 ? "text-blue-500" : "text-red-500"} pct={b.variacao.saldo} rot={rotAnt} />
        </div>
        {(b.previsto.abertas > 0 || b.previsto.perdidas > 0) && (
          <p className="text-xs text-muted-foreground border-t border-border pt-2">
            A receber: <strong className="text-orange-500">{BRL.format(b.previsto.abertas)}</strong>
            {b.previsto.perdidas > 0 && <> · Perdido: <strong className="text-red-500">{BRL.format(b.previsto.perdidas)}</strong></>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ titulo, v, cor, pct, rot, inv }: { titulo: string; v: number; cor: string; pct: number | null; rot: string; inv?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{titulo}</p>
      <p className={cn("text-sm sm:text-base font-semibold truncate", cor)}>{BRL.format(v)}</p>
      <VariacaoBadge pct={pct} rotulo={rot} invertColor={inv} />
    </div>
  );
}

function LinhaPrevista({ r, ocupado, onReceber, onPerda }: { r: PrevistaItem; ocupado: boolean; onReceber: () => void; onPerda: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <span className="text-foreground">{r.descricao}</span>
        <ParcelaChip r={r} />
        {r.cliente && <span className="text-muted-foreground"> — {r.cliente}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-xs", r.atrasada ? "text-red-500" : "text-muted-foreground")}>{fmtData(r.data_prevista)}</span>
        <span className="font-medium text-green-500">{BRL.format(r.valor)}</span>
        <Button variant="ghost" size="icon-sm" disabled={ocupado} onClick={onReceber} title="Confirmar recebimento">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        </Button>
        <Button variant="ghost" size="sm" disabled={ocupado} onClick={onPerda} title="Dar perda nesta receita" className="gap-1 text-red-500 hover:text-red-500 px-2">
          <ThumbsDown className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Perda</span>
        </Button>
      </div>
    </div>
  );
}
