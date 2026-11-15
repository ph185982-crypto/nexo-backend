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
        // Constantes da identidade Avanteza v2.0 (iguais no claro e no escuro) — valores em globals.css.
        marinho: { DEFAULT: "hsl(var(--marinho))", 2: "hsl(var(--marinho-2))" },
        creme: "hsl(var(--creme))",
        areia: "hsl(var(--areia))",
        laranja: { DEFAULT: "hsl(var(--laranja))", hover: "hsl(var(--laranja-hover))" }, // preenchimento, com texto marinho
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        kanban: {
          blue: "#3b82f6",
          green: "#22c55e",
          orange: "#f97316",
          purple: "#8b5cf6",
          red: "#ef4444",
          gray: "#6b7280",
          lightblue: "#60a5fa",
        },
      },
      borderRadius: {
        // Raio único de 6px (pílulas continuam em rounded-full).
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "calc(var(--radius) - 2px)",
      },
      fontFamily: {
        // Manrope em tudo; `titulo` continua existindo para não caçar classe por classe.
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        titulo: ["var(--font-manrope)", "system-ui", "sans-serif"],
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
