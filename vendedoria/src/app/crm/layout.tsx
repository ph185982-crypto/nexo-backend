"use client";

import React, { useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { NotificationPrompt } from "@/components/pwa/NotificationPrompt";
import { apiUrl } from "@/lib/api-url";
import { lembrar, SIDEBAR_KEY } from "@/lib/theme/tema";

// Casca do Vendedor IA/Comercial (mesmo desenho da Central): sidebar de vidro flutuante + barra superior + palco.
// O menu recolhido (telas largas) vem de data-sidebar no <html>, posto antes da pintura (src/lib/theme/tema.ts).
function CRMLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Botão de menu da barra superior: gaveta no celular; nas telas largas, recolhe/expande (igual ao botão da sidebar).
  const handleToggle = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSidebarOpen((v) => !v);
      return;
    }
    const d = document.documentElement;
    const recolher = d.getAttribute("data-sidebar") !== "collapsed";
    if (recolher) d.setAttribute("data-sidebar", "collapsed"); else d.removeAttribute("data-sidebar");
    lembrar(SIDEBAR_KEY, recolher ? "collapsed" : "expanded");
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  useEffect(() => setMobileSidebarOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileSidebarOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);

  return (
    <div className={`shell${mobileSidebarOpen ? " open" : ""}`}>
      <button type="button" className="scrim" aria-label="Fechar menu" tabIndex={-1} onClick={closeMobileSidebar} />
      <Sidebar onMobileClose={closeMobileSidebar} />

      <div className="shell-body">
        <Header onToggleSidebar={handleToggle} menuAberto={mobileSidebarOpen} />
        {/* Palco de vidro (telas largas): as telas cheias (conversas, quadros) ficam dentro de um painel arredondado.
            pb-tabbar reserva a altura da MobileTabBar + o home indicator (só no celular). */}
        <main className="palco pb-tabbar md:mb-4 md:mr-4 md:rounded-2xl md:vidro">
          {children}
        </main>
        <MobileTabBar />
      </div>
      <NotificationPrompt />
    </div>
  );
}

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    // Sob /comercial (na Central) a sessão do NextAuth responde em /comercial/api/auth; no domínio antigo, /api/auth.
    <SessionProvider basePath={apiUrl("/api/auth")}>
      <CRMLayoutInner>{children}</CRMLayoutInner>
    </SessionProvider>
  );
}
