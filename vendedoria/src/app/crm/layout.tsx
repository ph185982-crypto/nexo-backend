"use client";

import React, { useState, useCallback } from "react";
import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

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
        <main className="flex-1 overflow-auto bg-background flex flex-col min-h-0">
          {children}
        </main>
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
