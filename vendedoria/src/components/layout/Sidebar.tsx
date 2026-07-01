"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Kanban, Calendar, Megaphone,
  ChevronDown, ChevronRight, MessageSquare, Bot,
  Folder, Settings, Phone, Package, BarChart2, X, SlidersHorizontal,
  Zap, Globe, Wallet, Users,
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
  { href: "/crm", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/crm/conversations", label: "Conversas", icon: MessageSquare },
  { href: "/crm/metrics", label: "Métricas", icon: BarChart2 },
  { href: "/crm/lead/kanban", label: "Kanban", icon: Kanban },
  { href: "/crm/calendar", label: "Agenda", icon: Calendar },
  { href: "/crm/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/crm/products", label: "Produtos", icon: Package },
  { href: "/crm/configure-agent", label: "Configurar Agente", icon: SlidersHorizontal },
  { href: "/crm/pedidos",              label: "Pedidos Nacionais", icon: Globe },
  { href: "/crm/financeiro",           label: "Financeiro",        icon: Wallet },
  { href: "/crm/prospeccao/fila",      label: "Prospecção B2B",    icon: Users },
  { href: "/crm/prospeccao/dashboard", label: "Funil Prospecção",  icon: BarChart2 },
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
        "flex flex-col transition-all duration-300 flex-shrink-0",
        // Dark sidebar background — works in both light and dark modes
        "bg-[hsl(var(--sidebar-bg))]",
        // Mobile: fixed full-height overlay
        "fixed inset-y-0 left-0 z-50 h-full w-72",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: static
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
          <span className="font-bold text-base tracking-tight text-white truncate">NEXO</span>
          <span className="font-bold text-base tracking-tight text-emerald-400 truncate">VENDAS</span>
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
            const active = isActive(item.href, item.exact);
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

        {/* Organization section */}
        <div className={cn("px-2 pb-4", collapsed && "md:hidden")}>
          <button
            onClick={() => setOrgExpanded(!orgExpanded)}
            className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-semibold text-white/30 uppercase tracking-widest hover:text-white/60 transition-colors"
          >
            <span>Organização</span>
            {orgExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {orgExpanded && (
            <div className="space-y-0.5 mt-1">
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
                      "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs transition-colors",
                      selectedOrgId === org.id
                        ? "bg-white/15 text-white"
                        : "text-white/55 hover:bg-white/8 hover:text-white"
                    )}
                  >
                    <Folder className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{org.name}</span>
                    {expandedOrgs[org.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>

                  {expandedOrgs[org.id] && (org.accounts ?? []).map((account) => (
                    <div key={account.id} className="ml-4 space-y-0.5">
                      <button
                        onClick={() => onAccountSelect?.(account.id)}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs transition-colors",
                          selectedAccountId === account.id
                            ? "bg-white/15 text-white"
                            : "text-white/45 hover:bg-white/8 hover:text-white"
                        )}
                      >
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span className="flex-1 text-left truncate">{account.accountName}</span>
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                          account.status === "CONNECTED" ? "bg-emerald-400" : "bg-red-400"
                        )} />
                      </button>
                      {account.agent && (
                        <Link
                          href={`/crm/agents/chat/${account.id}`}
                          onClick={handleNavClick}
                          className={cn(
                            "flex items-center gap-2 w-full pl-6 pr-3 py-1.5 rounded-lg text-xs transition-colors",
                            pathname.includes(account.id)
                              ? "bg-white/15 text-white"
                              : "text-white/40 hover:bg-white/8 hover:text-white"
                          )}
                        >
                          <Bot className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{account.agent.displayName}</span>
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full ml-auto flex-shrink-0",
                            account.agent.status === "ACTIVE" ? "bg-emerald-400" : "bg-gray-500"
                          )} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {orgs.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">Nenhuma organização</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom settings */}
      <div className="border-t border-white/8 p-2 flex-shrink-0">
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
