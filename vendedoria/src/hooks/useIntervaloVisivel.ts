"use client";
// Polling que respeita a aba: só repete enquanto a página está visível e
// dispara uma atualização imediata quando ela volta a ficar visível. Cada
// tick é uma função serverless + conexão no banco — com a tela de conversas
// aberta em segundo plano o pool de 5 conexões estourava (P2024 em 27/10).
import { useEffect, useRef } from "react";

export function useIntervaloVisivel(fn: () => void, ms: number, ativo: boolean = true): void {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (!ativo || typeof document === "undefined") return;
    let t: ReturnType<typeof setInterval> | null = null;
    const ligar = () => {
      if (t) return;
      t = setInterval(() => ref.current(), ms);
    };
    const desligar = () => {
      if (t) clearInterval(t);
      t = null;
    };
    const aoMudar = () => {
      if (document.visibilityState === "visible") {
        ref.current();
        ligar();
      } else {
        desligar();
      }
    };
    if (document.visibilityState === "visible") ligar();
    document.addEventListener("visibilitychange", aoMudar);
    return () => {
      document.removeEventListener("visibilitychange", aoMudar);
      desligar();
    };
  }, [ms, ativo]);
}
