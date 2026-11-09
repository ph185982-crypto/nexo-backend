"use client";

import { useCallback, useEffect, useState } from "react";
import { moeda } from "@/lib/formatar";
import { botaoPrimario, campo } from "./dialogo";

interface Linha { id: string; produtoId: string | null; nome: string; quantidade: number; valorUnitario: number; desconto: number; recorrencia: string; total: number }
interface ProdutoCat { id: string; nome: string; valor: number; recorrencia: string }

const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Linhas de produto da oportunidade. Com linhas, o valor da oportunidade é a soma delas. */
export function AbaProdutos({ oportunidadeId, onAtividade }: { oportunidadeId: string; onAtividade: () => void }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [catalogo, setCatalogo] = useState<ProdutoCat[]>([]);
  const [nova, setNova] = useState({ produtoId: "", nome: "", quantidade: "1", valorUnitario: "", desconto: "0", recorrencia: "UNICO" });
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/produtos`);
    if (r.ok) setLinhas((await r.json()).produtos);
  }, [oportunidadeId]);
  useEffect(() => { setLinhas(null); void carregar(); }, [carregar]);
  useEffect(() => { fetch("/api/produtos").then((r) => r.json()).then((j) => setCatalogo(j.produtos ?? [])).catch(() => {}); }, []);

  const escolher = (id: string) => {
    const p = catalogo.find((x) => x.id === id);
    setNova(p ? { ...nova, produtoId: p.id, nome: p.nome, valorUnitario: String(p.valor), recorrencia: p.recorrencia } : { ...nova, produtoId: "" });
  };
  const chamar = async (url: string, metodo: string, corpo?: unknown) => {
    setErro(null);
    const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (!r.ok) { setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível salvar"); return false; }
    await carregar(); onAtividade();
    return true;
  };
  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await chamar(`/api/oportunidades/${oportunidadeId}/produtos`, "POST", { ...nova, produtoId: nova.produtoId || null });
    if (ok) setNova({ produtoId: "", nome: "", quantidade: "1", valorUnitario: "", desconto: "0", recorrencia: "UNICO" });
  };

  const unico = linhas?.filter((l) => l.recorrencia !== "MENSAL").reduce((s, l) => s + l.total, 0) ?? 0;
  const mensal = linhas?.filter((l) => l.recorrencia === "MENSAL").reduce((s, l) => s + l.total, 0) ?? 0;
  const pequeno = `${campo} !py-2 !text-[13px]`;

  return (
    <div className="px-5 pb-8 pt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead><tr className="border-b border-linha text-left text-[11px] uppercase tracking-[0.04em] text-cinza">
            <th className="px-2 py-2 font-bold">Produto</th><th className="px-2 py-2 text-right font-bold">Qtd.</th><th className="px-2 py-2 text-right font-bold">Valor unit.</th><th className="px-2 py-2 text-right font-bold">Desc.</th><th className="px-2 py-2 font-bold">Recorrência</th><th className="px-2 py-2 text-right font-bold">Total</th><th />
          </tr></thead>
          <tbody>
            {linhas === null && <tr><td colSpan={7} className="py-3 text-cinza">Carregando…</td></tr>}
            {linhas?.length === 0 && <tr><td colSpan={7} className="py-3 text-[12px] text-cinza">Nenhum produto. Sem produtos, os valores da oportunidade são os digitados em Editar.</td></tr>}
            {linhas?.map((l) => (
              <tr key={l.id} className="border-b border-linha">
                <td className="px-2 py-2 font-semibold">{l.nome}</td>
                <td className="px-2 py-2 text-right">{l.quantidade.toLocaleString("pt-BR")}</td>
                <td className="px-2 py-2 text-right">{reais(l.valorUnitario)}</td>
                <td className="px-2 py-2 text-right">{l.desconto ? `${l.desconto.toLocaleString("pt-BR")}%` : "—"}</td>
                <td className="py-2">{l.recorrencia === "MENSAL" ? "Mensal" : "Único"}</td>
                <td className="px-2 py-2 text-right font-bold">{reais(l.total)}</td>
                <td className="px-2 py-2 text-right"><button onClick={() => void chamar(`/api/oportunidades/${oportunidadeId}/produtos/${l.id}`, "DELETE")} aria-label={`Remover ${l.nome}`} className="rounded px-2 text-[16px] text-cinza hover:text-critico">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!linhas?.length && (
        <p className="mt-2 text-right text-[13px]"><span className="text-cinza">Único</span> <b>{moeda(unico)}</b> · <span className="text-cinza">Mensal</span> <b>{moeda(mensal)}</b></p>
      )}

      <form onSubmit={adicionar} className="mt-4 space-y-2 rounded-xl border border-linha p-3">
        <p className="text-[12px] font-bold">Adicionar produto</p>
        {catalogo.length > 0 && (
          <select value={nova.produtoId} onChange={(e) => escolher(e.target.value)} aria-label="Produto do catálogo" className={pequeno}>
            <option value="">Produto avulso (digitar)</option>
            {catalogo.map((p) => <option key={p.id} value={p.id}>{p.nome} · {reais(p.valor)}{p.recorrencia === "MENSAL" ? "/mês" : ""}</option>)}
          </select>
        )}
        <input required minLength={2} maxLength={120} value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nome" aria-label="Nome do produto" className={pequeno} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input inputMode="decimal" value={nova.quantidade} onChange={(e) => setNova({ ...nova, quantidade: e.target.value })} aria-label="Quantidade" placeholder="Qtd." className={pequeno} />
          <input required inputMode="decimal" value={nova.valorUnitario} onChange={(e) => setNova({ ...nova, valorUnitario: e.target.value })} aria-label="Valor unitário" placeholder="Valor unit." className={pequeno} />
          <input inputMode="decimal" value={nova.desconto} onChange={(e) => setNova({ ...nova, desconto: e.target.value })} aria-label="Desconto (%)" placeholder="Desc. %" className={pequeno} />
          <select value={nova.recorrencia} onChange={(e) => setNova({ ...nova, recorrencia: e.target.value })} aria-label="Recorrência" className={pequeno}><option value="UNICO">Único</option><option value="MENSAL">Mensal</option></select>
        </div>
        {erro && <p role="alert" className="text-[12px] font-semibold text-critico">{erro}</p>}
        <button type="submit" className={`${botaoPrimario} w-full`}>Adicionar</button>
      </form>
    </div>
  );
}
