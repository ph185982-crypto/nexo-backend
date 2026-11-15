import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Identidade Avanteza v2.0: Manrope em tudo (texto, títulos e números).
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "CRM · Avanteza",
  description: "Consultoria e Estratégia — funil, contatos e entrega.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
