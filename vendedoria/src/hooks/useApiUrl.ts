"use client";
import { usePathname } from "next/navigation";
import { apiUrl } from "@/lib/api-url";

/**
 * apiUrl para atributos renderizados (href/src): usa o caminho do roteador, igual no servidor e no navegador
 * (sob /comercial o servidor já renderiza com o endereço da zona), sem diferença de hidratação.
 */
export function useApiUrl(): (caminho: string) => string {
  const pathname = usePathname() ?? "";
  return (caminho: string) => apiUrl(caminho, pathname);
}
