import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ApolloProvider } from "@/lib/graphql/ApolloProvider";

export const metadata: Metadata = {
  title: "VendedorIA — CRM Inteligente para WhatsApp",
  description: "Gerencie seus leads e automatize suas vendas via WhatsApp com IA",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Vendedoria",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

// Viewport precisa ser exportado separadamente no Next.js 15
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5C400",
  // maximumScale removido — permitir zoom no mobile (acessibilidade)
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">
        <ApolloProvider>{children}</ApolloProvider>
      </body>
    </html>
  );
}
