import { cn } from "@/lib/utils";

// Logotipo Avanteza v2.0: a palavra em minúsculas (Manrope 800, entreletra -0.045em) e um quadrado
// laranja no lugar do ponto final. A cor do texto vem de quem usa (className); o quadrado é sempre laranja.
export function Logo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Avanteza" className={cn("logo", className)}>
      avanteza<span className="logo-ponto" aria-hidden />
    </span>
  );
}
