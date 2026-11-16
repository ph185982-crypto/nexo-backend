"use client";

// Aba "Contratos" da ficha da oportunidade: contratos ligados a ela e o atalho para gerar um novo, pré-preenchido.
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/api-url";
import { data } from "@/lib/comercial/formatar";
import { reais } from "@/lib/comercial/contratos/modelo";
import { StatusContrato } from "./contratos/status";

interface Item { id: string; razaoSocial: string; filename: string; valor: number | null; status: string; criadoEm: string; enviadoEm: string | null; assinadoEm: string | null }

export const linkNovoContrato = (oportunidadeId: string) => `/comercial/contratos?novo=1&oportunidade=${encodeURIComponent(oportunidadeId)}`;

export function AbaContratos({ oportunidadeId }: { oportunidadeId: string }) {
  const [lista, setLista] = useState<Item[] | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(apiUrl(`/api/comercial/contratos?oportunidade=${encodeURIComponent(oportunidadeId)}`)).then((r) => r.json()).then((j) => { if (vivo) setLista(j.contratos ?? []); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [oportunidadeId]);
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Contrato assinado na ClickSign ganha esta oportunidade sozinho.</p>
        <Link href={linkNovoContrato(oportunidadeId)} className="rounded-md bg-laranja px-3 py-1.5 text-[12px] font-extrabold text-marinho">Gerar contrato</Link>
      </div>
      {lista === null && <p className="mt-3 text-[13px] text-muted-foreground">Carregando…</p>}
      {lista?.length === 0 && <p className="mt-3 text-[13px] text-muted-foreground">Nenhum contrato ligado a esta oportunidade.</p>}
      {!!lista?.length && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {lista.map((c) => (
            <li key={c.id}>
              <Link href={`/comercial/contratos?abrir=${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 hover:bg-background">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{c.filename}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{c.assinadoEm ? `Assinado em ${data(c.assinadoEm)}` : c.enviadoEm ? `Enviado em ${data(c.enviadoEm)}` : `Gerado em ${data(c.criadoEm)}`}{c.valor !== null ? ` · ${reais(c.valor)}/mês` : ""}</span>
                </span>
                <StatusContrato status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
