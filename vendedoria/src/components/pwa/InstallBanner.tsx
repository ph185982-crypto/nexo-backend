"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "nexo-pwa-install-dismissed";

export function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // User already dismissed
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setVisible(false);
    setPrompt(null);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-emerald-800/60 bg-[#0d1f17]/95 px-4 py-3 shadow-2xl backdrop-blur-md"
      role="banner"
    >
      <img
        src="/icon-192.png"
        alt="Nexo Vendas"
        className="h-10 w-10 flex-shrink-0 rounded-xl"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">
          Instalar Nexo Vendas
        </p>
        <p className="truncate text-xs text-emerald-400/80">
          Acesse mais rápido, direto da sua tela inicial
        </p>
      </div>

      <button
        onClick={install}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-emerald-700"
        aria-label="Instalar aplicativo"
      >
        <Download className="h-3.5 w-3.5" />
        Instalar
      </button>

      <button
        onClick={dismiss}
        className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-200"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
