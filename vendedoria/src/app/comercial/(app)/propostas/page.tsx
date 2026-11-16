"use client";

// Comercial › Propostas: o que foi enviado aos clientes, com status e o link público. Criar e editar ficam na ficha
// da oportunidade (aba Propostas).
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/api-url";
import { data, moeda } from "@/lib/comercial/formatar";

interface PropostaDTO {
  id: string; codigo: string; status: string; titulo: string; valorUnico: number; valorMensal: number; validaAte: string | null; token: string;
  enviadaEm: string | null; visualizadaEm: string | null; respondidaEm: string | null; respostaNome: string | null; vencida: boolean;
  oportunidade: { id: string; funilId: string; nome: string; contato: { nome: string } };
}

const ROTULO: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADA: "Enviada", ACEITA: "Aceita", RECUSADA: "Recusada", OBSOLETA: "Substituída" };
const FILTROS = [["", "Ativas"], ["RASCUNHO", "Rascunhos"], ["ENVIADA", "Enviadas"], ["ACEITA", "Aceitas"], ["RECUSADA", "Recusadas"]] as const;

function Situacao({ p }: { p: PropostaDTO }) {
  if (p.vencida) return <span className="rounded-full border border-destructive px-2 py-0.5 text-[11px] font-bold text-destructive">Vencida</span>;
  const cor = p.status === "ACEITA" ? "bg-primary text-primary-foreground" : p.status === "ENVIADA" ? "bg-laranja text-marinho" : "bg-secondary text-secondary-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cor}`}>{ROTULO[p.status] ?? p.status}</span>;
}

export default function PropostasPage() {
  const [status, setStatus] = useState("");
  const [lista, setLista] = useState<PropostaDTO[] | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setLista(null);
    fetch(apiUrl(`/api/comercial/propostas${status ? `?status=${status}` : ""}`)).then((r) => r.json()).then((j) => { if (vivo) setLista(j.propostas ?? []); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [status]);
  const copiar = async (p: PropostaDTO) => {
    await navigator.clipboard?.writeText(`${window.location.origin}/comercial/p/${p.token}`).catch(() => {});
    setCopiado(p.id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div>
          <h1 className="text-[20px] font-extrabold">Propostas</h1>
          <p className="text-[12px] text-muted-foreground">Crie e edite pela ficha da oportunidade (aba Propostas).</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar propostas">
          {FILTROS.map(([v, r]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => setStatus(v)}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${status === v ? "border-primary bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"}`}>{r}</button>
          ))}
        </div>
      </header>
      <div className="px-4 py-4 sm:px-6">
        {lista === null && <p className="text-[13px] text-muted-foreground">Carregando…</p>}
        {lista?.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center">
            <p className="text-[14px] font-semibold">Nenhuma proposta aqui.</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Abra uma oportunidade e use a aba Propostas para montar a primeira a partir dos produtos.</p>
          </div>
        )}
        {!!lista?.length && (
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{p.titulo}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {p.codigo} · {p.oportunidade.contato.nome} ·{" "}
                    <Link href={`/comercial/oportunidades?funil=${p.oportunidade.funilId}&abrir=${p.oportunidade.id}`} className="font-semibold text-foreground underline-offset-2 hover:underline">{p.oportunidade.nome}</Link>
                  </p>
                </div>
                <div className="text-right text-[12px]">
                  <p className="font-bold">{moeda(p.valorUnico + p.valorMensal)}</p>
                  <p className="text-muted-foreground">{p.respondidaEm ? `Respondida em ${data(p.respondidaEm)}${p.respostaNome ? ` por ${p.respostaNome}` : ""}` : p.enviadaEm ? `Enviada em ${data(p.enviadaEm)}${p.visualizadaEm ? " · aberta" : ""}` : "Não enviada"}</p>
                </div>
                <Situacao p={p} />
                {p.status !== "RASCUNHO" && (
                  <button onClick={() => void copiar(p)} className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold hover:border-primary">{copiado === p.id ? "Link copiado" : "Copiar link"}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
