"use client";

import { useEffect, useRef } from "react";

/** Diálogo modal nativo (<dialog>): foco preso e ESC fechando, sem biblioteca. */
export function Dialogo({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onFechar}
      onClick={(e) => { if (e.target === ref.current) onFechar(); }}
      className="w-[min(420px,92vw)] rounded-md bg-superficie p-0 text-marinho"
    >
      <div className="p-6">
        <h2 className="mb-4 text-[18px] font-extrabold">{titulo}</h2>
        {children}
      </div>
    </dialog>
  );
}

export const campo = "w-full rounded-md border border-areia bg-superficie px-3 py-2.5 text-[14px]";
export const botaoPrimario = "rounded-md bg-marinho hover:bg-marinho-2 px-4 py-2.5 text-[13px] font-bold text-creme disabled:opacity-50";
export const botaoSecundario = "rounded-md border border-marinho px-4 py-2.5 text-[13px] font-bold text-marinho";
