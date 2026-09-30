"use client";

// Peças compartilhadas entre a Visão Geral e a aba Receitas: formatação,
// badge de status, diálogo de PERDA e as chamadas de ação sobre uma receita.

import React, { useState } from "react";
import { Loader2, ThumbsDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Datas do financeiro são "só data" em UTC — sempre formatar em UTC para não voltar um dia. */
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/** Mês corrente (YYYY-MM) no fuso de Brasília. */
export function mesAtualBR(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export function somarMesesStr(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface ReceitaItem {
  id: string;
  descricao: string;
  valor: number;
  data_prevista: string;
  cliente: string | null;
  tipo_negocio: string | null;
  status: string;
  atrasada?: boolean;
  data_recebimento?: string | null;
  motivo_perda?: string | null;
  data_perda?: string | null;
  contrato_id?: string | null;
  parcela_numero?: number | null;
  parcelas_total?: number | null;
}

export function StatusReceitaBadge({ r }: { r: Pick<ReceitaItem, "status" | "atrasada" | "motivo_perda"> }) {
  if (r.status === "recebida") return <Badge variant="success">Recebida</Badge>;
  if (r.status === "perdida") {
    return (
      <Badge variant="muted" title={r.motivo_perda ? `Motivo: ${r.motivo_perda}` : "Receita perdida"}>
        Perdida
      </Badge>
    );
  }
  if (r.atrasada || r.status === "atrasada") return <Badge variant="destructive">Atrasada</Badge>;
  return <Badge variant="warning">Pendente</Badge>;
}

export function ParcelaChip({ r }: { r: Pick<ReceitaItem, "parcela_numero" | "parcelas_total"> }) {
  if (!r.parcela_numero) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {r.parcela_numero}{r.parcelas_total ? `/${r.parcelas_total}` : ""}
    </span>
  );
}

export type AcaoReceita = "confirmar" | "perder" | "reverter_perda";

export async function executarAcaoReceita(
  id: string,
  acao: AcaoReceita,
  motivo?: string,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    const res = await fetch(`/api/financeiro/receitas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao, ...(motivo ? { motivo } : {}) }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({}));
    return { ok: false, erro: j.error ?? `Erro ${res.status}` };
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." };
  }
}

/** Diálogo de confirmação de PERDA, com motivo opcional. */
export function PerdaDialog({
  receita, onClose, onDone,
}: {
  receita: ReceitaItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fechar = () => { setMotivo(""); setErro(null); onClose(); };

  const confirmar = async () => {
    if (!receita) return;
    setSalvando(true);
    setErro(null);
    const r = await executarAcaoReceita(receita.id, "perder", motivo.trim() || undefined);
    setSalvando(false);
    if (!r.ok) { setErro(r.erro ?? "Não foi possível dar a perda."); return; }
    setMotivo("");
    onDone();
    onClose();
  };

  return (
    <Dialog open={!!receita} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsDown className="w-4 h-4 text-red-500" /> Dar perda nesta receita?
          </DialogTitle>
          <DialogDescription>
            {receita && (
              <>
                <strong className="text-foreground">{receita.descricao}</strong>
                {receita.cliente ? ` — ${receita.cliente}` : ""} · {BRL.format(receita.valor)} · {fmtData(receita.data_prevista)}
                <br />
                Ela sai da previsão e não conta como receita, mas continua gravada no histórico — dá para desfazer depois.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (opcional) — ex.: cliente cancelou, inadimplência…"
          rows={3}
          maxLength={300}
        />
        {erro && <p className="text-sm text-red-500">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvando}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void confirmar()} disabled={salvando} className="gap-1.5">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar perda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
