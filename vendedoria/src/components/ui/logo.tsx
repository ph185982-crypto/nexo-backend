import { cn } from "@/lib/utils";

// Logotipo Avanteza (igual ao da Central): a palavra em minúsculas (peso 800, entreletra -0.045em) e o ponto laranja
// redondo no lugar do ponto final. A cor do texto vem de quem usa (className); o ponto é sempre laranja.
export function Logo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Avanteza" className={cn("logo", className)}>
      avanteza<span className="logo-ponto" aria-hidden />
    </span>
  );
}
