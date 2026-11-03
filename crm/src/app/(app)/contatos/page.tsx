"use client";

import { useEffect, useState } from "react";

interface Item { id: string; tipo: string; nome: string; telefone: string | null; email: string | null; segmento: string | null; cicloDeVida: string; empresa: { nome: string } | null; _count: { oportunidades: number } }
interface Resposta { total: number; pagina: number; porPagina: number; itens: Item[] }

const CICLO: Record<string, string> = { LEAD: "Lead", PROSPECT: "Prospect", CLIENTE: "Cliente", DESCARTADO: "Descartado" };

export default function ContatosPage() {
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);

  useEffect(() => { const t = setTimeout(() => { setBusca(q); setPagina(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/contatos?pagina=${pagina}&q=${encodeURIComponent(busca)}`).then((r) => r.json()).then((j) => { if (vivo) setDados(j); });
    return () => { vivo = false; };
  }, [busca, pagina]);

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 px-6 py-3.5">
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight">Contatos</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar contatos"
          className="ml-auto w-80 rounded-full border border-linha bg-superficie px-4 py-2 text-[13px]" />
      </header>
      <div className="mx-6 flex-1 overflow-auto rounded-xl border border-linha bg-superficie">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-superficie text-[11px] uppercase tracking-wide text-cinza">
            <tr>{["Nome", "Telefone", "E-mail", "Segmento", "Ciclo de vida", "Oportunidades"].map((h) => <th key={h} className="border-b border-linha px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {dados?.itens.map((c) => (
              <tr key={c.id} className="border-b border-linha last:border-0">
                <td className="px-4 py-2.5"><span className="font-semibold">{c.nome}</span>{c.empresa && <span className="block text-[12px] text-cinza">{c.empresa.nome}</span>}</td>
                <td className="px-4 py-2.5 text-cinza">{c.telefone ?? "—"}</td>
                <td className="px-4 py-2.5 text-cinza">{c.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-cinza">{c.segmento ?? "—"}</td>
                <td className="px-4 py-2.5">{CICLO[c.cicloDeVida] ?? c.cicloDeVida}</td>
                <td className="px-4 py-2.5">{c._count.oportunidades}</td>
              </tr>
            ))}
            {dados && dados.itens.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-cinza">Nenhum contato encontrado.</td></tr>}
            {!dados && <tr><td colSpan={6} className="px-4 py-10 text-center text-cinza">Carregando…</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between px-6 py-3 text-[12px] text-cinza">
        <span>{dados ? `${dados.total} contato(s)` : ""}</span>
        <span className="flex items-center gap-3">
          <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-linha px-3 py-1 disabled:opacity-40">Anterior</button>
          {pagina} de {paginas}
          <button disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)} className="rounded-md border border-linha px-3 py-1 disabled:opacity-40">Próxima</button>
        </span>
      </footer>
    </div>
  );
}
