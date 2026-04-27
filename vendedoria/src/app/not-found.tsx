"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/login"), 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <p className="text-6xl font-bold text-white/20">404</p>
        <p className="text-white font-semibold text-lg">Página não encontrada</p>
        <p className="text-white/60 text-sm">Redirecionando para o login em 3 segundos…</p>
        <button
          onClick={() => router.replace("/login")}
          className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition"
        >
          Ir para o login agora
        </button>
      </div>
    </div>
  );
}
