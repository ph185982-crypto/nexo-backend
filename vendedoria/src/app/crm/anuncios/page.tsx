"use client";

// Resultado por anúncio Click-to-WhatsApp: leads, qualificados, ganhos e valor.

import React, { useEffect, useState } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Linha {
  adSourceId: string | null; adHeadline: string | null;
  leads: number; qualificados: number; ganhos: number; valorGanho: number; ganhosSemValor: number;
}
interface Resposta { anuncios: Linha[]; total: Omit<Linha, "adSourceId" | "adHeadline"> }

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const diasAtras = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - n * 86_400_000));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

const inputCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary";

export default function AnunciosPage() {
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hojeBR());
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    fetch(`/api/anuncios/resumo?de=${de}&ate=${ate}`)
      .then(async (r) => { if (!r.ok) throw new Error(`Erro ${r.status}`); return r.json() as Promise<Resposta>; })
      .then((j) => { if (vivo) setDados(j); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [de, ate]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" /> Resultado dos anúncios
          </h1>
          <p className="text-sm text-muted-foreground">De qual anúncio cada lead veio, quantos qualificaram e quantos viraram venda.</p>
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-1">De <input type="date" className={inputCls} value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
        <label className="text-xs text-muted-foreground flex items-center gap-1">Até <input type="date" className={inputCls} value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
      </div>

      {erro ? (
        <p className="text-sm text-red-500">{erro}</p>
      ) : !dados ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : dados.anuncios.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Nenhum lead de anúncio neste período. A origem só é gravada para quem clica num anúncio Click-to-WhatsApp e manda a 1ª mensagem.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Leads", String(dados.total.leads)],
              ["Qualificados", `${dados.total.qualificados} (${pct(dados.total.qualificados, dados.total.leads)})`],
              ["Ganhos", `${dados.total.ganhos} (${pct(dados.total.ganhos, dados.total.leads)})`],
              ["Valor ganho", BRL.format(dados.total.valorGanho)],
            ].map(([rotulo, valor]) => (
              <Card key={rotulo}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{rotulo}</p><p className="text-lg font-semibold text-foreground">{valor}</p></CardContent></Card>
            ))}
          </div>
          {dados.total.ganhosSemValor > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{dados.total.ganhosSemValor} ganho(s) sem valor de contrato preenchido — o valor ganho não os inclui.</p>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="font-medium p-3">Anúncio</th>
                    <th className="font-medium p-3 text-right">Leads</th>
                    <th className="font-medium p-3 text-right">Qualificados</th>
                    <th className="font-medium p-3 text-right">Ganhos</th>
                    <th className="font-medium p-3 text-right">Valor ganho</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.anuncios.map((a) => (
                    <tr key={a.adSourceId ?? "sem-id"} className="border-b border-border/50 last:border-0">
                      <td className="p-3">
                        <p className="text-foreground">{a.adHeadline ?? "(sem título)"}</p>
                        <p className="text-[11px] text-muted-foreground">{a.adSourceId ? `ID ${a.adSourceId}` : "sem ID de anúncio"}</p>
                      </td>
                      <td className="p-3 text-right">{a.leads}</td>
                      <td className="p-3 text-right">{a.qualificados} <span className="text-xs text-muted-foreground">({pct(a.qualificados, a.leads)})</span></td>
                      <td className="p-3 text-right">{a.ganhos} <span className="text-xs text-muted-foreground">({pct(a.ganhos, a.leads)})</span></td>
                      <td className="p-3 text-right">{BRL.format(a.valorGanho)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
