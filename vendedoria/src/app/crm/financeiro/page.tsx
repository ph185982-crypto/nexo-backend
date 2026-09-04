"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import {
  Wallet, FileText, Receipt, Landmark,
  PieChart, TrendingUp, LineChart, ShieldAlert, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OverviewTab } from "@/components/financeiro/OverviewTab";
import { ExtratoTab } from "@/components/financeiro/ExtratoTab";
import { ContasTab } from "@/components/financeiro/ContasTab";
import { DividasTab } from "@/components/financeiro/DividasTab";
import { OrcamentosTab } from "@/components/financeiro/OrcamentosTab";
import { ReceitasTab } from "@/components/financeiro/ReceitasTab";
import { ProjecaoTab } from "@/components/financeiro/ProjecaoTab";

const tabs = [
  { key: "visao-geral", label: "Visao Geral", icon: Wallet },
  { key: "extrato",     label: "Extrato",     icon: FileText },
  { key: "contas",      label: "Contas",       icon: Receipt },
  { key: "dividas",     label: "Dividas",      icon: Landmark },
  { key: "orcamentos",  label: "Orcamentos",   icon: PieChart },
  { key: "receitas",    label: "Receitas",      icon: TrendingUp },
  { key: "projecao",    label: "Projecao",      icon: LineChart },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function FinanceiroPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<TabKey>("visao-geral");

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if ((session?.user as Record<string, unknown>)?.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-6">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Acesso restrito</h2>
        <p className="text-muted-foreground max-w-md">
          Apenas administradores podem acessar o modulo financeiro.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex overflow-x-auto scrollbar-hide px-4 gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {activeTab === "visao-geral" && <OverviewTab />}
        {activeTab === "extrato"     && <ExtratoTab />}
        {activeTab === "contas"      && <ContasTab />}
        {activeTab === "dividas"     && <DividasTab />}
        {activeTab === "orcamentos"  && <OrcamentosTab />}
        {activeTab === "receitas"    && <ReceitasTab />}
        {activeTab === "projecao"    && <ProjecaoTab />}
      </div>
    </div>
  );
}
