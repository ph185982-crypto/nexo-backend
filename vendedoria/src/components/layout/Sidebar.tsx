"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Kanban, Calendar, Megaphone,
  ChevronDown, ChevronRight, MessageSquare, Bot,
  Folder, Settings, Phone, Package, BarChart2, X, SlidersHorizontal,
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
  { href: "/crm/conversations", label: "Conversas",  icon: MessageSquare },
  { href: "/crm/pipeline",      label: "Pipeline",   icon: Kanban },
  { href: "/crm/dashboard",     label: "Dashboard",  icon: LayoutDashboard },
  { href: "/crm/reports",       label: "Relatórios", icon: BarChart2 },
  { href: "/crm/agent",         label: "Agente IA",  icon: Bot },
];

export function Sidebar({
  collapsed,
  mobileOpen = false,
  onMobileClose,
  selectedOrgId,
  onOrgSelect,
  selectedAccountId,
  onAccountSelect,
}: SidebarProps) {
  const pathname = usePathname();
  const [orgExpanded, setOrgExpanded] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});

  const { data } = useQuery(GET_ORGS, { fetchPolicy: "cache-and-network" });
  const orgs = data?.whatsappBusinessOrganizations ?? [];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  const handleNavClick = () => onMobileClose?.();

  return (
    <aside
      className={cn(
        "flex flex-col bg-primary text-white transition-all duration-300 flex-shrink-0",
        // Mobile: fixed full-height overlay, z-50, slide in/out
        "fixed inset-y-0 left-0 z-50 h-full w-72",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: static positioning, width based on collapsed
        "md:relative md:h-full md:translate-x-0",
        collapsed ? "md:w-16" : "md:w-64"
      )}
    >
      {/* Logo + mobile close button */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 flex-shrink-0">
        <div className="flex-shrink-0 w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
          <Bot className="w-5 h-5 text-accent" />
        </div>
        <div className={cn("flex items-baseline gap-1 flex-1", collapsed && "md:hidden")}>
          <span className="font-bold text-lg text-white">VENDEDOR</span>
          <span className="font-bold text-lg text-accent">IA</span>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={onMobileClose}
          className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 md:hidden flex-shrink-0"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Organization Section — hidden when collapsed on desktop */}
        <div className={cn("px-2 pb-4", collapsed && "md:hidden")}>
          <button
            onClick={() => setOrgExpanded(!orgExpanded)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-white/50 uppercase tracking-wider hover:text-white/80 transition-colors"
          >
            <span>Organização</span>
            {orgExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {orgExpanded && (
            <div className="space-y-1 mt-1">
              {orgs.map((org: {
                id: string;
                name: string;
                accounts?: Array<{
                  id: string;
                  accountName: string;
                  displayPhoneNumber: string;
                  status: string;
                  agent?: { id: string; displayName: string; kind: string; status: string } | null;
                }>;
              }) => (
                <div key={org.id}>
                  <button
                    onClick={() => {
                      onOrgSelect?.(org.id);
                      setExpandedOrgs((prev) => ({ ...prev, [org.id]: !prev[org.id] }));
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors",
                      selectedOrgId === org.id
                        ? "bg-white/20 text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <Folder className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate text-xs">{org.name}</span>
                    {expandedOrgs[org.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>

                  {expandedOrgs[org.id] && (org.accounts ?? []).map((account) => (
                    <div key={account.id} className="ml-4 space-y-1">
                      <button
                        onClick={() => onAccountSelect?.(account.id)}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs transition-colors",
                          selectedAccountId === account.id
                            ? "bg-white/20 text-white"
                            : "text-white/60 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span className="flex-1 text-left truncate">{account.accountName}</span>
                        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", account.status === "CONNECTED" ? "bg-accent" : "bg-red-400")} />
                      </button>
                      {account.agent && (
                        <Link
                          href={`/crm/agents/chat/${account.id}`}
                          onClick={handleNavClick}
                          className={cn(
                            "flex items-center gap-2 w-full pl-6 pr-3 py-1.5 rounded-lg text-xs transition-colors",
                            pathname.includes(account.id)
                              ? "bg-white/20 text-white"
                              : "text-white/50 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <MessageSquare className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{account.agent.displayName}</span>
                          <span className={cn("w-1.5 h-1.5 rounded-full ml-auto flex-shrink-0", account.agent.status === "ACTIVE" ? "bg-accent" : "bg-gray-400")} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {orgs.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/40">Nenhuma organização</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom Settings */}
      <div className="border-t border-white/10 p-2 flex-shrink-0">
        <Link
          href="/crm/settings"
          onClick={handleNavClick}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Configurações</span>
        </Link>
      </div>
    </aside>
  );
}
