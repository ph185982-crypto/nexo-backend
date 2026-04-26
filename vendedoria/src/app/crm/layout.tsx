"use client";

import React, { useState, useCallback } from "react";
import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { usePushNotifications } from "@/hooks/usePushNotifications";

function PushBanner() {
  const { permissao, suportado, ativar } = usePushNotifications();
  if (!suportado || permissao !== "default") return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20 text-sm flex-shrink-0">
      <span className="text-foreground/80 text-xs">
        Ative notificações para saber quando chegar mensagem
      </span>
      <button
        onClick={ativar}
        className="flex-shrink-0 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
      >
        Ativar
      </button>
    </div>
  );
}

function CRMLayoutInner({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();

  const handleToggle = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSidebarOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggle={handleToggle}
        onMobileClose={closeMobileSidebar}
        selectedOrgId={selectedOrgId}
        onOrgSelect={setSelectedOrgId}
        selectedAccountId={selectedAccountId}
        onAccountSelect={setSelectedAccountId}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header onToggleSidebar={handleToggle} />
        <PushBanner />
        <main className="flex-1 overflow-hidden bg-background flex flex-col min-h-0 pb-16 md:pb-0">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <CRMLayoutInner>{children}</CRMLayoutInner>
    </SessionProvider>
  );
}
