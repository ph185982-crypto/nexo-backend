"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const STORAGE_KEY = "nexo-notif-prompt-dismissed";

export function NotificationPrompt() {
  const { permissao, suportado, ativar } = usePushNotifications();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!suportado) return;
    if (permissao !== "default") return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;

    // Show prompt after 4s — gives user time to orient in the CRM
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, [suportado, permissao]);

  function dismiss() {
    sessionStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  async function handleAtivar() {
    setLoading(true);
    const result = await ativar();
    setLoading(false);
    if (result !== "default") setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ativar notificações"
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={dismiss} />

      {/* Card */}
      <div className="relative w-full max-w-sm rounded-2xl border border-emerald-800/50 bg-[#0d1f17] p-6 shadow-2xl">
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:text-slate-200"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-900/60 ring-1 ring-emerald-700/50">
          <Bell className="h-6 w-6 text-emerald-400" />
        </div>

        <h2 className="mb-1 text-base font-semibold text-white">
          Notificações de vendas
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-slate-400">
          Receba alertas instantâneos quando houver um{" "}
          <span className="text-emerald-400 font-medium">pedido novo</span>,{" "}
          <span className="text-amber-400 font-medium">lead quente</span> ou{" "}
          <span className="text-red-400 font-medium">escalação</span> — mesmo com o app em segundo plano.
        </p>

        <div className="flex gap-3">
          <button
            onClick={dismiss}
            className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-medium text-slate-400 hover:border-slate-600 hover:text-slate-300"
          >
            Agora não
          </button>
          <button
            onClick={handleAtivar}
            disabled={loading}
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? "Aguarde..." : "Ativar notificações"}
          </button>
        </div>
      </div>
    </div>
  );
}
