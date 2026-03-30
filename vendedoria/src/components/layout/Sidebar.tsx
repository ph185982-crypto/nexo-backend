"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Kanban, Calendar, Megaphone, Building2,
  Users, ChevronDown, ChevronRight, MessageSquare, Bot,
  Folder, Settings, Phone, Package,
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
  onToggle: () => void;
  selectedOrgId?: string;
  onOrgSelect?: (orgId: string) => void;
  selectedAccountId?: string;
  onAccountSelect?: (accountId: string) => void;
}

const navItems = [
  { href: "/crm", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/crm/lead/kanban", label: "Kanban", icon: Kanban },
  { href: "/crm/calendar", label: "Agenda", icon: Calendar },
  { href: "/crm/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/crm/work-units", label: "Unidades", icon: Building2 },
  { href: "/crm/professionals", label: "Profissionais", icon: Users },
  { href: "/crm/products", label: "Produtos", icon: Package },
];

export function Sidebar({
  collapsed,
  selectedOrgId,
  onOrgSelect,
  selectedAccountId,
  onAccountSelect,
}: SidebarProps) {
  const pathname = usePathname();
  const [orgExpanded, setOrgExpanded] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});

  const { data } = useQuery(GET_ORGS, {
    fetchPolicy: "cache-and-network",
  });

  const orgs = data?.whatsappBusinessOrganizations ?? [];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-primary text-white transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
        <div className="flex-shrink-0 w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
          <Bot className="w-5 h-5 text-accent" />
        </div>
        {!collapsed && (
          <div className="flex items-baseline gap-1">
            <span className="font-bold text-lg text-white">VENDEDOR</span>
            <span className="font-bold text-lg text-accent">IA</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <nav className="py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-white/20 text-white font-medium"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Organization Section */}
        {!collapsed && (
          <div className="px-2 pb-4">
            <button
              onClick={() => setOrgExpanded(!orgExpanded)}
              className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-white/50 uppercase tracking-wider hover:text-white/80 transition-colors"
            >
              <span>Organização</span>
              {orgExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
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
                        setExpandedOrgs((prev) => ({
                          ...prev,
                          [org.id]: !prev[org.id],
                        }));
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
                      {expandedOrgs[org.id] ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
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
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full flex-shrink-0",
                              account.status === "CONNECTED" ? "bg-accent" : "bg-red-400"
                            )}
                          />
                        </button>
                        {account.agent && (
                          <Link
                            href={`/crm/agents/chat/${account.id}`}
                            className={cn(
                              "flex items-center gap-2 w-full pl-6 pr-3 py-1.5 rounded-lg text-xs transition-colors",
                              pathname.includes(account.id)
                                ? "bg-white/20 text-white"
                                : "text-white/50 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <MessageSquare className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{account.agent.displayName}</span>
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full ml-auto flex-shrink-0",
                                account.agent.status === "ACTIVE" ? "bg-accent" : "bg-gray-400"
                              )}
                            />
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {orgs.length === 0 && (
                  <p className="px-3 py-2 text-xs text-white/40">
                    Nenhuma organização
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Bottom Settings */}
      <div className="border-t border-white/10 p-2">
        <Link
          href="/crm/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Configurações</span>}
        </Link>
      </div>
    </aside>
  );
}
