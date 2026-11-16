"use client";

import React from "react";
import Link from "next/link";
import { hrefNaZona } from "@/lib/zona-comercial";
import { usePathname } from "next/navigation";
import {
  Kanban, Calendar, MessageSquare, Bot,
  Settings, X, Radar, Wallet, ChevronLeft, ChevronRight,
  PhoneCall, Send, Briefcase, Users, ListChecks, CalendarClock, FileText, FileSignature, ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Logo } from "@/components/ui/logo";
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

type ItemMenu = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; externo?: boolean };

// Fora do menu (as rotas continuam existindo): Funil de Entrega antigo (/crm/delivery), Anúncios (/crm/anuncios,
// vai para o Marketing da Central), Pedidos e Checkout. O Financeiro mora na Central (as rotas daqui seguem para o
// Max e para a API de serviço).
export const gruposMenu: Array<{ titulo: string | null; itens: ItemMenu[] }> = [
  {
    titulo: null,
    itens: [
      { href: "/crm/conversations",   label: "Conversas",    icon: MessageSquare },
      { href: "/crm/ligacoes",        label: "Ligações",     icon: PhoneCall },
      { href: "/crm/lead/kanban",     label: "Leads (SDR)",  icon: Kanban },
      { href: "/crm/prospeccao",      label: "Prospecções",  icon: Radar },
      { href: "/crm/disparos",        label: "Disparos",     icon: Send },
      { href: "/crm/calendar",        label: "Calendário",   icon: Calendar },
      { href: "/crm/configure-agent", label: "Agente",       icon: Bot },
    ],
  },
  {
    titulo: "Comercial",
    itens: [
      { href: "/comercial/oportunidades", label: "Oportunidades", icon: Briefcase },
      { href: "/comercial/contatos",      label: "Contatos",      icon: Users },
      { href: "/comercial/tarefas",       label: "Tarefas",       icon: ListChecks },
      { href: "/comercial/agenda",        label: "Agenda",        icon: CalendarClock },
      { href: "/comercial/propostas",     label: "Propostas",     icon: FileText },
      { href: "/comercial/contratos",     label: "Contratos",     icon: FileSignature },
    ],
  },
  {
    titulo: null,
    itens: [{ href: "https://app.avanteza.com.br/financeiro", label: "Financeiro", icon: Wallet, externo: true }],
  },
];

export function Sidebar({
  collapsed,
  mobileOpen = false,
  onToggle,
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

  // Sob /comercial (endereço na Central), os links das telas antigas também ficam sob /comercial (zona-comercial.ts).
  const href = (h: string) => hrefNaZona(h, pathname);
  const isActive = (h: string) => pathname.startsWith(h) || pathname.startsWith(href(h));

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
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 flex-shrink-0">
        {/* Recolhida: só o "a" com o quadrado laranja. */}
        <span aria-hidden className={cn("logo hidden text-2xl text-creme w-8 text-center", collapsed && "md:inline-block")}>a<span className="logo-ponto" /></span>
        <div className={cn("flex flex-col flex-1 min-w-0", collapsed && "md:hidden")}>
          <Logo className="text-2xl text-creme" />
          <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.25em] text-areia">Vendedor IA</span>
        </div>
        <button
          onClick={onMobileClose}
          className="p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 md:hidden flex-shrink-0"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Chevron de minimizar — fixado na borda, sempre visível, sem depender
          do hamburger do header pra descobrir que o sidebar recolhe. */}
      <button
        onClick={onToggle}
        className="hidden md:flex absolute -right-3 top-16 w-6 h-6 items-center justify-center rounded-full bg-[hsl(var(--sidebar-bg))] ring-1 ring-white/15 text-white/60 hover:text-white hover:ring-white/30 transition-colors z-10"
        aria-label={collapsed ? "Expandir menu" : "Minimizar menu"}
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <ScrollArea className="flex-1">
        <nav className="py-3 px-2">
          {gruposMenu.map((grupo, gi) => (
            <div key={grupo.titulo ?? `g${gi}`} className={cn("space-y-0.5", gi > 0 && "mt-3 pt-3 border-t border-white/10")}>
              {grupo.titulo && (
                <p className={cn("px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-areia", collapsed && "md:hidden")}>{grupo.titulo}</p>
              )}
              {grupo.itens.map((item) => {
                const Icon = item.icon;
                const active = !item.externo && isActive(item.href);
                const classe = cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/85 hover:bg-white/10 hover:text-white"
                );
                const conteudo = (
                  <>
                    <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-white" : "")} />
                    <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
                    {item.externo && <ArrowUpRight className={cn("ml-auto w-3.5 h-3.5 opacity-70", collapsed && "md:hidden")} aria-hidden />}
                    {active && !collapsed && (
                      <span className="ml-auto w-1 h-4 rounded-full bg-laranja flex-shrink-0" />
                    )}
                  </>
                );
                return item.externo ? (
                  <a key={item.href} href={item.href} onClick={handleNavClick} className={classe} title="Abre na Central Avanteza">{conteudo}</a>
                ) : (
                  <Link key={item.href} href={href(item.href)} onClick={handleNavClick} className={classe}>{conteudo}</Link>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Status do WhatsApp + Configurações */}
      <div className="border-t border-white/10 p-2 flex-shrink-0 space-y-1">
        {conta && (
          <div className={cn("flex items-center gap-2 px-3 py-2 text-xs text-white/75", collapsed && "md:hidden")}>
            <span className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              conta.status === "CONNECTED" ? "bg-green-400" : "bg-red-400"
            )} />
            <span className="truncate">WhatsApp {conta.displayPhoneNumber}</span>
          </div>
        )}
        <Link
          href={href("/crm/settings")}
          onClick={handleNavClick}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/85 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Configurações</span>
        </Link>
      </div>
    </aside>
  );
}
