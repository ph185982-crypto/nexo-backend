import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ApolloProvider } from "@/lib/graphql/ApolloProvider";
import { InstallBanner } from "@/components/pwa/InstallBanner";

// Identidade Avanteza v2.0: Manrope em tudo (texto, títulos e números).
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Vendedor IA · Avanteza",
  description: "Gerencie seus leads e automatize suas vendas via WhatsApp com IA",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vendedor IA",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // statusBarStyle é "black-translucent": sem viewportFit=cover o conteúdo
  // fica por baixo do notch e do home indicator no iPhone.
  viewportFit: "cover",
  // Zoom por pinça continua liberado de propósito (acessibilidade). O
  // auto-zoom ao focar input é evitado via font-size 16px no globals.css,
  // que resolve a causa sem tirar o zoom de quem precisa.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F0E6" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1B33" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={manrope.variable}
      suppressHydrationWarning
    >
      <head>
        {/* PWA — Service Worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function(err) { console.warn('[SW] Registration failed:', err); });
  });
}
`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ApolloProvider>{children}</ApolloProvider>
          <InstallBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
