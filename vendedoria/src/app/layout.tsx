import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@/styles/avanteza-tokens.css"; // cópia do kit Avanteza (tokens do vidro, claro e escuro)
import "./globals.css";
import { ApolloProvider } from "@/lib/graphql/ApolloProvider";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { ativo } from "@/lib/zona-comercial";
import { THEME_INIT_SCRIPT, SIDEBAR_INIT_SCRIPT, THEME_COLORS } from "@/lib/theme/tema";

// Visual "vidro" da plataforma Avanteza (kit): Plus Jakarta Sans em tudo, como na Central.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: "Vendedor IA · Avanteza",
  description: "Gerencie seus leads e automatize suas vendas via WhatsApp com IA",
  manifest: ativo("/manifest.json"), // /comercial/… responde nos dois domínios (src/lib/zona-comercial.ts)
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vendedor IA",
  },
  icons: {
    icon: ativo("/icon-192.png"),
    apple: ativo("/icon-192.png"),
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
  themeColor: THEME_COLORS.dark, // o botão de tema troca para a cor do tema escolhido
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={jakarta.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Tema e menu recolhido antes da pintura (sem flash): mesmas chaves da Central (src/lib/theme/tema.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SIDEBAR_INIT_SCRIPT }} />
        {/* PWA — Service Worker registration. Sob /comercial a origem é a da Central (app.avanteza.com.br):
            um service worker do Vendedor IA com escopo "/" tomaria conta das páginas da Central, então não registra. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if ('serviceWorker' in navigator && !/^\\/comercial(\\/|$)/.test(location.pathname)) {
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
        <ApolloProvider>{children}</ApolloProvider>
        <InstallBanner />
      </body>
    </html>
  );
}
