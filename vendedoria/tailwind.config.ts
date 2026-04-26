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
        // ── Semantic tokens (map to CSS vars) ────────────────────────────────
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border:  "hsl(var(--border))",
        input:   "hsl(var(--input))",
        ring:    "hsl(var(--ring))",
        sidebar: {
          DEFAULT:    "hsl(var(--sidebar-bg))",
          foreground: "hsl(var(--sidebar-fg))",
          accent:     "hsl(var(--sidebar-accent))",
          border:     "hsl(var(--sidebar-border))",
        },
        // ── Status chips ──────────────────────────────────────────────────────
        kanban: {
          blue:      "#3b82f6",
          green:     "#22c55e",
          orange:    "#f97316",
          purple:    "#8b5cf6",
          red:       "#ef4444",
          gray:      "#6b7280",
          lightblue: "#60a5fa",
        },
      },
      borderRadius: {
        "2xl": "1rem",
        xl:    "0.75rem",
        lg:    "0.5rem",
        md:    "0.375rem",
        sm:    "0.25rem",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-in":        "fadeIn 0.25s ease-in",
        "slide-in":       "slideIn 0.3s ease-out",
        "pulse-dot":      "pulseDot 2s ease-in-out infinite",
        "shimmer":        "shimmer 2s linear infinite",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        fadeIn:    { from: { opacity: "0" }, to: { opacity: "1" } },
        slideIn:   { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        pulseDot:  {
          "0%, 100%": { opacity: "1",   transform: "scale(1)" },
          "50%":      { opacity: "0.6", transform: "scale(1.4)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to:   { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
