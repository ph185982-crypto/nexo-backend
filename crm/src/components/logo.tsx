// Logotipo Avanteza v2.0: a palavra em minúsculas (Manrope 800, entreletra -0.045em) e um quadrado
// laranja no lugar do ponto final. É texto, não imagem — herda a nitidez em qualquer tamanho.
export function Logo({ variante, tamanho = 26 }: { variante: "marinho" | "creme"; tamanho?: number }) {
  return (
    <span role="img" aria-label="Avanteza" className={`logo ${variante === "creme" ? "text-creme" : "text-marinho"}`} style={{ fontSize: tamanho }}>
      avanteza<span className="logo-ponto" aria-hidden />
    </span>
  );
}
