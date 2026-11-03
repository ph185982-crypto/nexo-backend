import type { Config } from "tailwindcss";

// Todas as cores vêm de variáveis CSS (src/app/globals.css) — nenhum hex solto nos componentes.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        azul: { DEFAULT: "var(--azul)", 8: "var(--azul-08)" },
        laranja: "var(--laranja)",
        bq: "var(--bq)",
        grafite: "var(--grafite)",
        cinza: "var(--cinza)",
        superficie: "var(--superficie)",
        linha: "var(--linha)",
        critico: "var(--critico)",
        ok: "var(--ok)",
      },
      fontFamily: {
        titulo: ["var(--font-manrope)", "Montserrat", "system-ui", "sans-serif"],
        texto: ["var(--font-inter)", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
