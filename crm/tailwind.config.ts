import type { Config } from "tailwindcss";

// Identidade Avanteza v2.0 — a paleta mora AQUI (única fonte). O globals.css lê estes valores com theme()
// e os componentes usam só as classes (bg-marinho, text-suave…): nenhum hex solto fora deste arquivo.
export const PALETA = {
  marinho: "#0B1B33",      // texto, barra lateral/topo, botão padrão
  marinho2: "#132A4C",     // hover do marinho
  creme: "#F5F0E6",        // fundo de página e texto sobre marinho
  areia: "#EAD9C2",        // bordas, divisórias, pílulas secundárias
  laranja: "#FF6A1F",      // só ação principal, foco e destaque — como preenchimento, com texto marinho
  laranjaHover: "#E85A12",
  superficie: "#FFFFFF",   // cartões
  suave: "#55637A",        // texto secundário (o #64748B do kit não passa em AA sobre creme)
  ok: "#047857",
  perigo: "#DC2626",       // preenchimento/ponto de alerta
  perigoTexto: "#B91C1C",  // texto de alerta (o #DC2626 não passa em AA sobre creme)
} as const;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        marinho: { DEFAULT: PALETA.marinho, 2: PALETA.marinho2 },
        creme: PALETA.creme,
        areia: PALETA.areia,
        laranja: { DEFAULT: PALETA.laranja, hover: PALETA.laranjaHover },
        superficie: PALETA.superficie,
        suave: PALETA.suave,
        ok: PALETA.ok,
        perigo: { DEFAULT: PALETA.perigo, texto: PALETA.perigoTexto },
      },
      fontFamily: {
        // Manrope em tudo; `titulo` e `texto` continuam existindo para não caçar classe por classe.
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        titulo: ["var(--font-manrope)", "system-ui", "sans-serif"],
        texto: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
