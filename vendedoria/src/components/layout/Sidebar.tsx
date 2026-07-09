"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Kanban, Calendar, MessageSquare, Bot,
  Settings, X, Zap, Radar, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@apollo/client";
import { gql } from "@apollo/client";

const GET_ORGS = gql`
  query GetOrgs {
    whatsappBusinessOrganizations {
      id
      name
      status
      accounts {
        id
        accountName
        displayPhoneNumber
        status
        agent { id displayName kind status }
      }
    }
  }
`;

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
  selectedOrgId?: string;
  onOrgSelect?: (orgId: string) => void;
  selectedAccountId?: string;
  onAccountSelect?: (accountId: string) => void;
}

const navItems = [
  { href: "/crm/conversations", label: "Conversas",   icon: MessageSquare },
  { href: "/crm/lead/kanban",   label: "CRM",         icon: Kanban },
  { href: "/crm/prospeccao",    label: "Prospecções", icon: Radar },
  { href: "/crm/calendar",      label: "Calendário",  icon: Calendar },
  { href: "/crm/configure-agent", label: "Agente",    icon: Bot },
  { href: "/crm/financeiro",    label: "Financeiro",  icon: Wallet },
];

export function Sidebar({
  collapsed,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();

  const { data } = useQuery(GET_ORGS, { fetchPolicy: "cache-and-network" });
  const orgs: Array<{
    id: string;
    name: string;
    status: string;
    accounts?: Array<{ id: string; displayPhoneNumber: string; status: string }>;
  }> = data?.whatsappBusinessOrganizations ?? [];

  const orgAtiva = orgs.find((o) => o.status === "ACTIVE");
  const conta = orgAtiva?.accounts?.[0];

  const isActive = (href: string) => pathname.startsWith(href);

  const handleNavClick = () => onMobileClose?.();

  return (
    <aside
      className={cn(
        "flex flex-col transition-all duration-300 flex-shrink-0",
        "bg-[hsl(var(--sidebar-bg))]",
        "fixed inset-y-0 left-0 z-50 h-full w-72",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:relative md:h-full md:translate-x-0",
        collapsed ? "md:w-16" : "md:w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/8 flex-shrink-0">
        <div className="flex-shrink-0 w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center ring-1 ring-white/10">
          <Zap className="w-4 h-4 text-emerald-400" />
        </div>
        <div className={cn("flex items-baseline gap-1 flex-1 min-w-0", collapsed && "md:hidden")}>
          <span className="font-bold text-lg tracking-tight text-white truncate">NEXO</span>
        </div>
        <button
          onClick={onMobileClose}
          className="p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 md:hidden flex-shrink-0"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="py-3 px-2 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/55 hover:bg-white/8 hover:text-white/90"
                )}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-emerald-400" : "")} />
                <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
                {active && !collapsed && (
                  <span className="ml-auto w-1 h-4 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Status do WhatsApp + Configurações */}
      <div className="border-t border-white/8 p-2 flex-shrink-0 space-y-1">
        {conta && (
          <div className={cn("flex items-center gap-2 px-3 py-2 text-xs text-white/40", collapsed && "md:hidden")}>
            <span className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              conta.status === "CONNECTED" ? "bg-emerald-400" : "bg-red-400"
            )} />
            <span className="truncate">WhatsApp {conta.displayPhoneNumber}</span>
          </div>
        )}
        <Link
          href="/crm/settings"
          onClick={handleNavClick}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/50 hover:bg-white/8 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Configurações</span>
        </Link>
      </div>
    </aside>
  );
}
