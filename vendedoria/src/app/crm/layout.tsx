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
    <div style={{
      background: "#F5C400", color: "#1A1A2E",
      padding: "10px 16px", display: "flex",
      alignItems: "center", justifyContent: "space-between",
      flexShrink: 0, zIndex: 60,
    }}>
      <span style={{ fontSize: "13px", fontWeight: 500 }}>
        🔔 Ative notificações para saber quando chegar mensagem
      </span>
      <button onClick={ativar} style={{
        background: "#1A1A2E", color: "#F5C400",
        border: "none", padding: "6px 16px",
        borderRadius: "6px", cursor: "pointer",
        fontWeight: 700, fontSize: "13px",
        flexShrink: 0, marginLeft: "12px",
      }}>
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
      {/* Mobile backdrop overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}

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
        <main className="flex-1 overflow-hidden bg-background flex flex-col min-h-0 pb-[60px] md:pb-0">
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
