import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#004c3f",
          foreground: "#ffffff",
          50: "#e6f2f0",
          100: "#b3d9d3",
          200: "#80bfb7",
          300: "#4da69b",
          400: "#1a8c7e",
          500: "#004c3f",
          600: "#003d33",
          700: "#002e26",
          800: "#001f1a",
          900: "#00100d",
        },
        accent: {
          DEFAULT: "#00ff87",
          foreground: "#004c3f",
        },
        background: "#f5f5f5",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#111827",
        },
        border: "#e5e7eb",
        input: "#e5e7eb",
        ring: "#004c3f",
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "#f3f4f6",
          foreground: "#6b7280",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#111827",
        },
        secondary: {
          DEFAULT: "#f3f4f6",
          foreground: "#374151",
        },
        foreground: "#111827",
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
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fadeIn 0.3s ease-in",
        "slide-in": "slideIn 0.3s ease-out",
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
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
