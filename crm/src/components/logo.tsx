import Image from "next/image";

// Arquivo do logotipo enviado pela marca (public/brand). Nunca redigitar "avanteza" com fonte comum.
// Proporção original preservada: 1079 × 191.
const RAZAO = 1079 / 191;

export function Logo({ variante, largura = 150 }: { variante: "azul" | "bq"; largura?: number }) {
  return (
    <Image
      src={`/brand/avanteza-logo-${variante}.png`}
      alt="Avanteza"
      width={largura}
      height={Math.round(largura / RAZAO)}
      priority
    />
  );
}
