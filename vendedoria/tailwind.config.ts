import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Cores de status da prospecção vivem aqui (compartilhadas com as rotas)
    "./src/lib/prospeccao/status.ts",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // Constantes da marca Avanteza (iguais no claro e no escuro) — valores do kit em globals.css.
        marinho: { DEFAULT: "hsl(var(--marinho))", 2: "hsl(var(--marinho-2))" },
        creme: "hsl(var(--creme))",
        areia: "hsl(var(--areia))",
        // Laranja: preenchimento com texto marinho; como texto/ícone só `laranja-texto` (queimado no claro).
        laranja: { DEFAULT: "hsl(var(--laranja))", hover: "hsl(var(--laranja-hover))", texto: "hsl(var(--laranja-texto))" },
        ok: { texto: "hsl(var(--ok-texto))" },
        aviso: { texto: "hsl(var(--aviso-texto))" },
        // Superfícies de vidro: cor + alfa do tema (--x-a); o modificador /NN multiplica o alfa do tema.
        accent: {
          DEFAULT: "hsl(var(--accent) / calc(<alpha-value> * var(--accent-a)))",
          foreground: "hsl(var(--accent-foreground))",
        },
        background: "hsl(var(--background) / calc(<alpha-value> * var(--background-a)))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card) / calc(<alpha-value> * var(--card-a)))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / calc(<alpha-value> * var(--popover-a)))",
          foreground: "hsl(var(--popover-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / calc(<alpha-value> * var(--muted-a)))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      // Raios do kit (vidro): cartões 22px, diálogos 26px, campos 14px, itens 16px; pílulas em rounded-full.
      borderRadius: {
        "2xl": "var(--avz-radius-lg)",
        xl: "var(--avz-radius)",
        lg: "var(--avz-radius-item)",
        md: "var(--avz-radius-md)",
        sm: "var(--avz-radius-sm)",
      },
      // Sombras suaves do kit (nada de sombra dura do Tailwind).
      boxShadow: {
        vidro: "var(--avz-shadow)",
        suave: "var(--avz-shadow-sm)",
        brilho: "var(--avz-glow)",
      },
      fontFamily: {
        // Plus Jakarta Sans em tudo (kit); `titulo` continua existindo para não caçar classe por classe.
        sans: ["var(--font-jakarta)", "Plus Jakarta Sans", "system-ui", "sans-serif"],
        titulo: ["var(--font-jakarta)", "Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "monospace"],
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fadeIn 0.2s ease-in",
        "slide-in": "slideIn 0.25s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideIn: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
