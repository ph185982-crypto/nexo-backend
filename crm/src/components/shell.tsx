"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";
import { Nav } from "./nav";

/** Desktop: barra lateral fixa. Celular: barra no topo com menu em gaveta (fecha ao navegar). */
export function Shell({ nome, admin, children }: { nome: string; admin: boolean; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();
  useEffect(() => setAberto(false), [caminho]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto]);

  const lateral = (
    <>
      <div className="px-2"><Logo variante="bq" largura={150} /></div>
      <Nav nome={nome} admin={admin} />
    </>
  );
  return (
    <div className="flex h-dvh flex-col lg:grid lg:grid-cols-[232px_1fr]">
      <header className="flex flex-none items-center justify-between bg-azul px-4 py-3 lg:hidden">
        <Logo variante="bq" largura={120} />
        <button onClick={() => setAberto(true)} aria-label="Abrir menu" aria-expanded={aberto} className="rounded-lg p-2 text-bq">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
      <aside className="hidden flex-col gap-8 bg-azul px-4 py-5 lg:flex">{lateral}</aside>
      {aberto && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-grafite/50" onClick={() => setAberto(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col gap-8 overflow-y-auto bg-azul px-4 py-5">
            <button onClick={() => setAberto(false)} aria-label="Fechar menu" className="-mb-4 self-end rounded-lg p-1 text-[22px] leading-none text-bq">×</button>
            {lateral}
          </aside>
        </div>
      )}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
