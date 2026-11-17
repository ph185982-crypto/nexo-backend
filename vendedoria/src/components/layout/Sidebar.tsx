"use client";

// Menu lateral de vidro — o mesmo desenho da Central (kit Avanteza): grupos por área, ícones de traço, item ativo
// laranja com texto marinho, recolhível a uma coluna de ícones (data-sidebar no <html>, lembrado em "avanteza-menu",
// aplicado antes da pintura) e gaveta no celular. O CSS está em globals.css (.sidebar, .sb-*).
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { hrefNaZona } from "@/lib/zona-comercial";
import { usePathname } from "next/navigation";
import {
  Kanban, Calendar, MessageSquare, Bot,
  Settings, X, Radar, Wallet, ChevronsLeft, ChevronsRight,
  PhoneCall, Send, Briefcase, Users, ListChecks, CalendarClock, FileText, FileSignature, ArrowUpRight, LayoutGrid,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-switcher";
import { useApiUrl } from "@/hooks/useApiUrl";
import { lembrar, SIDEBAR_KEY, type SidebarState } from "@/lib/theme/tema";
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
  onMobileClose?: () => void;
}

type ItemMenu = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; externo?: boolean };

// Fora do menu (as rotas continuam existindo): Funil de Entrega antigo (/crm/delivery), Anúncios (/crm/anuncios,
// vai para o Marketing da Central), Pedidos e Checkout. O Financeiro mora na Central (as rotas daqui seguem para o
// Max e para a API de serviço).
export const gruposMenu: Array<{ titulo: string | null; itens: ItemMenu[] }> = [
  {
    titulo: "Vendedor IA",
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
    titulo: "Na Central",
    itens: [{ href: "https://app.avanteza.com.br/financeiro", label: "Financeiro", icon: Wallet, externo: true }],
  },
];

export function Sidebar({ onMobileClose }: SidebarProps) {
  const pathname = usePathname() ?? "";
  const api = useApiUrl(); // sob /comercial: /comercial/api/… (o atalho da Central passa pelo login único)

  const { data } = useQuery(GET_ORGS, { fetchPolicy: "cache-and-network" });
  const orgs: Array<{
    id: string;
    name: string;
    status: string;
    accounts?: Array<{ id: string; displayPhoneNumber: string; status: string }>;
  }> = data?.whatsappBusinessOrganizations ?? [];

  const orgAtiva = orgs.find((o) => o.status === "ACTIVE");
  const conta = orgAtiva?.accounts?.[0];

  // O visual recolhido vem de data-sidebar no <html> (script no <head>); aqui só espelhamos para o botão e as dicas.
  const [recolhido, setRecolhido] = useState(false);
  useEffect(() => setRecolhido(document.documentElement.getAttribute("data-sidebar") === "collapsed"), []);
  const alternarMenu = () => {
    const prox: SidebarState = recolhido ? "expanded" : "collapsed";
    if (prox === "collapsed") document.documentElement.setAttribute("data-sidebar", "collapsed");
    else document.documentElement.removeAttribute("data-sidebar");
    lembrar(SIDEBAR_KEY, prox);
    setRecolhido(prox === "collapsed");
  };

  // Sob /comercial (endereço na Central), os links das telas antigas também ficam sob /comercial (zona-comercial.ts).
  const href = (h: string) => hrefNaZona(h, pathname);
  const isActive = (h: string) => pathname.startsWith(h) || pathname.startsWith(href(h));
  const dica = (rotulo: string) => (recolhido ? rotulo : undefined);
  const inicio = href("/crm/conversations");

  return (
    <aside className="sidebar" id="menu-lateral" aria-label="Menu lateral">
      <div className="sb-brand">
        <Link href={inicio} onClick={onMobileClose} className="sb-brand-txt" aria-label="Vendedor IA — início">
          <Logo className="text-[22px]" />
          <span className="sb-sub">Vendedor IA · Comercial</span>
        </Link>
        <Link href={inicio} onClick={onMobileClose} className="sb-mark" aria-label="Vendedor IA — início"><span aria-hidden="true">a<i /></span></Link>
        <ThemeToggle className="sb-theme h-[38px] w-[38px]" />
        <button type="button" onClick={onMobileClose} className="icon-btn sb-close" aria-label="Fechar menu">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Atalho de volta à Central (outros módulos, login único). */}
      <a href={api("/api/sso/central")} className="sb-link sb-central" title={recolhido ? "Central Avanteza" : "Voltar à Central Avanteza"}>
        <LayoutGrid aria-hidden />
        <span className="sb-text">Central</span>
        <ArrowUpRight className="sb-ext" aria-hidden />
      </a>

      <nav className="sb-nav" aria-label="Principal">
        {gruposMenu.map((grupo, gi) => (
          <div key={grupo.titulo ?? `g${gi}`} role="group" aria-label={grupo.titulo ?? undefined}>
            {grupo.titulo && <div className="sb-label">{grupo.titulo}</div>}
            {grupo.itens.map((item) => {
              const Icon = item.icon;
              const conteudo = (
                <>
                  <Icon aria-hidden />
                  <span className="sb-text">{item.label}</span>
                  {item.externo && <ArrowUpRight className="sb-ext" aria-hidden />}
                </>
              );
              return item.externo ? (
                <a key={item.href} href={item.href} onClick={onMobileClose} className="sb-link" title={recolhido ? item.label : "Abre na Central Avanteza"}>{conteudo}</a>
              ) : (
                <Link key={item.href} href={href(item.href)} onClick={onMobileClose} className="sb-link" title={dica(item.label)} aria-current={isActive(item.href) ? "page" : undefined}>
                  {conteudo}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sb-foot">
        {conta && (
          <div className="sb-zap" title={`WhatsApp ${conta.displayPhoneNumber}`}>
            <i className={conta.status === "CONNECTED" ? "bg-green-400" : "bg-red-400"} aria-hidden />
            <span className="sb-text">WhatsApp {conta.displayPhoneNumber}</span>
          </div>
        )}
        <Link href={href("/crm/settings")} onClick={onMobileClose} className="sb-link sb-muted" title={dica("Configurações")} aria-current={isActive("/crm/settings") ? "page" : undefined}>
          <Settings aria-hidden />
          <span className="sb-text">Configurações</span>
        </Link>
        <button
          type="button"
          className="sb-link sb-muted sb-collapse"
          onClick={alternarMenu}
          aria-pressed={recolhido}
          aria-controls="menu-lateral"
          title={recolhido ? "Expandir menu" : "Recolher menu"}
        >
          {recolhido ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
          <span className="sb-text">{recolhido ? "Expandir menu" : "Recolher menu"}</span>
        </button>
      </div>
    </aside>
  );
}
