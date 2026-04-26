"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Kanban, Megaphone,
  ChevronDown, ChevronRight, MessageSquare, Bot,
  Settings, Phone, Package, BarChart2, X, Radio, Truck,
  ChevronLeft, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, gql } from "@apollo/client";

const GET_ORGS = gql`
  query GetOrgs {
    whatsappBusinessOrganizations {
      id name status
      accounts {
        id accountName displayPhoneNumber status
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

const navGroups = [
  {
    label: "Principal",
    items: [
      { href: "/crm/conversations", label: "Conversas",   icon: MessageSquare },
      { href: "/crm/pipeline",      label: "Pipeline",    icon: Kanban },
      { href: "/crm/dashboard",     label: "Dashboard",   icon: LayoutDashboard },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/crm/products",  label: "Produtos",    icon: Package },
      { href: "/crm/produtos",  label: "Fornecedor",  icon: Truck },
      { href: "/crm/ofertas",   label: "Ofertas",     icon: Megaphone },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/crm/reports",  label: "Relatórios",  icon: BarChart2 },
      { href: "/crm/disparos", label: "Disparos",    icon: Radio },
    ],
  },
  {
    label: "IA",
    items: [
      { href: "/crm/agent",    label: "Agente IA",   icon: Bot },
    ],
  },
];

export function Sidebar({
  collapsed,
  mobileOpen = false,
  onToggle,
  onMobileClose,
  selectedOrgId,
  onOrgSelect,
  selectedAccountId,
  onAccountSelect,
}: SidebarProps) {
  const pathname = usePathname();
  const [orgExpanded, setOrgExpanded] = useState(false);
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});

  const { data } = useQuery(GET_ORGS, { fetchPolicy: "cache-and-network" });
  const orgs = data?.whatsappBusinessOrganizations ?? [];

  const isActive = (href: string) => pathname.startsWith(href);
  const close = () => onMobileClose?.();

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          // Layout
          "flex flex-col flex-shrink-0 overflow-hidden",
          "transition-all duration-300 ease-in-out",
          // Colors — sidebar-bg token
          "bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))]",
          "border-r border-[hsl(var(--sidebar-border))]",
          // Mobile: slide-over
          "fixed inset-y-0 left-0 z-50 h-full w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, collapsible width
          "md:relative md:h-full md:translate-x-0",
          collapsed ? "md:w-[60px]" : "md:w-60"
        )}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <div className={cn(
          "flex items-center gap-3 px-4 h-16 border-b border-[hsl(var(--sidebar-border))] flex-shrink-0",
          collapsed ? "md:justify-center md:px-0" : ""
        )}>
          <div className="w-7 h-7 rounded-lg bg-[hsl(var(--sidebar-accent))] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[hsl(var(--sidebar-accent)/0.4)]">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className={cn("flex items-baseline gap-0.5 min-w-0", collapsed && "md:hidden")}>
            <span className="font-bold text-base tracking-tight text-[hsl(var(--sidebar-fg))]">Nexo</span>
            <span className="font-bold text-base tracking-tight text-[hsl(var(--sidebar-accent))]">Vendas</span>
          </div>
          <button
            onClick={close}
            className="ml-auto p-1 rounded-md text-[hsl(var(--sidebar-fg)/0.5)] hover:text-[hsl(var(--sidebar-fg))] hover:bg-white/10 md:hidden"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <ScrollArea className="flex-1">
          <nav className="py-3 px-2 space-y-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--sidebar-fg)/0.35)]">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={close}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                          collapsed && "md:justify-center md:px-0",
                          active
                            ? "sidebar-active-gradient text-[hsl(var(--sidebar-accent))] font-medium border border-[hsl(var(--sidebar-accent)/0.2)]"
                            : "text-[hsl(var(--sidebar-fg)/0.6)] hover:text-[hsl(var(--sidebar-fg))] hover:bg-white/5"
                        )}
                      >
                        <Icon className={cn("w-4 h-4 flex-shrink-0", active && "drop-shadow-[0_0_6px_hsl(var(--sidebar-accent)/0.8)]")} />
                        <span className={cn("leading-none", collapsed && "md:hidden")}>{item.label}</span>
                        {active && !collapsed && (
                          <span className="ml-auto w-1 h-4 rounded-full bg-[hsl(var(--sidebar-accent))] opacity-80" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* ── Organisations ───────────────────────────────────────────── */}
            {!collapsed && (
              <div>
                <button
                  onClick={() => setOrgExpanded(!orgExpanded)}
                  className="flex items-center justify-between w-full px-3 py-1 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--sidebar-fg)/0.35)] hover:text-[hsl(var(--sidebar-fg)/0.6)] transition-colors"
                >
                  <span>Organização</span>
                  {orgExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>

                {orgExpanded && (
                  <div className="space-y-0.5">
                    {orgs.map((org: {
                      id: string; name: string;
                      accounts?: Array<{
                        id: string; accountName: string; displayPhoneNumber: string; status: string;
                        agent?: { id: string; displayName: string; kind: string; status: string } | null;
                      }>;
                    }) => (
                      <div key={org.id}>
                        <button
                          onClick={() => {
                            onOrgSelect?.(org.id);
                            setExpandedOrgs(p => ({ ...p, [org.id]: !p[org.id] }));
                          }}
                          className={cn(
                            "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs transition-colors",
                            selectedOrgId === org.id
                              ? "bg-white/10 text-[hsl(var(--sidebar-fg))]"
                              : "text-[hsl(var(--sidebar-fg)/0.6)] hover:bg-white/5 hover:text-[hsl(var(--sidebar-fg))]"
                          )}
                        >
                          <span className="flex-1 text-left truncate">{org.name}</span>
                          {expandedOrgs[org.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>

                        {expandedOrgs[org.id] && (org.accounts ?? []).map((acc) => (
                          <div key={acc.id} className="ml-3 pl-3 border-l border-[hsl(var(--sidebar-border))] space-y-0.5">
                            <button
                              onClick={() => onAccountSelect?.(acc.id)}
                              className={cn(
                                "flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[11px] transition-colors",
                                selectedAccountId === acc.id
                                  ? "text-[hsl(var(--sidebar-fg))] bg-white/10"
                                  : "text-[hsl(var(--sidebar-fg)/0.5)] hover:bg-white/5 hover:text-[hsl(var(--sidebar-fg))]"
                              )}
                            >
                              <Phone className="w-3 h-3 flex-shrink-0" />
                              <span className="flex-1 truncate">{acc.accountName}</span>
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                acc.status === "CONNECTED" ? "bg-emerald-400" : "bg-red-400"
                              )} />
                            </button>
                            {acc.agent && (
                              <Link
                                href={`/crm/agents/chat/${acc.id}`}
                                onClick={close}
                                className={cn(
                                  "flex items-center gap-2 w-full pl-4 pr-2 py-1.5 rounded-lg text-[11px] transition-colors",
                                  pathname.includes(acc.id)
                                    ? "text-[hsl(var(--sidebar-fg))] bg-white/10"
                                    : "text-[hsl(var(--sidebar-fg)/0.4)] hover:bg-white/5 hover:text-[hsl(var(--sidebar-fg))]"
                                )}
                              >
                                <MessageSquare className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate flex-1">{acc.agent.displayName}</span>
                                <span className={cn(
                                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                  acc.agent.status === "ACTIVE" ? "bg-[hsl(var(--sidebar-accent))] animate-pulse-dot" : "bg-gray-500"
                                )} />
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                    {orgs.length === 0 && (
                      <p className="px-3 py-2 text-xs text-[hsl(var(--sidebar-fg)/0.3)]">Nenhuma organização</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </nav>
        </ScrollArea>

        {/* ── Bottom row: settings + collapse toggle ────────────────────────── */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-2 flex items-center gap-1 flex-shrink-0">
          <Link
            href="/crm/settings"
            onClick={close}
            title={collapsed ? "Configurações" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[hsl(var(--sidebar-fg)/0.6)] hover:bg-white/5 hover:text-[hsl(var(--sidebar-fg))] transition-colors flex-1",
              collapsed && "md:justify-center md:flex-initial"
            )}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Configurações</span>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={onToggle}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[hsl(var(--sidebar-fg)/0.4)] hover:text-[hsl(var(--sidebar-fg))] hover:bg-white/5 transition-colors flex-shrink-0"
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            <ChevronLeft className={cn("w-4 h-4 transition-transform duration-300", collapsed && "rotate-180")} />
          </button>
        </div>
      </aside>
    </>
  );
}
