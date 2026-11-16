"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Kanban, Briefcase, ListChecks, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefNaZona } from "@/lib/zona-comercial";

// Cinco atalhos; o resto (Prospecções, Disparos, Contatos, Agenda, Propostas, Financeiro na Central…) fica no menu lateral.
const tabs = [
  { href: "/crm/conversations",       label: "Conversas",     icon: MessageSquare },
  { href: "/crm/lead/kanban",         label: "Leads",         icon: Kanban },
  { href: "/comercial/oportunidades", label: "Oportunidades", icon: Briefcase },
  { href: "/comercial/tarefas",       label: "Tarefas",       icon: ListChecks },
  { href: "/crm/configure-agent",     label: "Agente",        icon: Bot },
];

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className={cn(
      "mobile-tab-bar fixed bottom-0 left-0 right-0 z-50 md:hidden",
      "bg-card/85 backdrop-blur-xl border-t border-border",
      "flex safe-area-bottom"
    )}>
      {tabs.map((t) => {
        const href = hrefNaZona(t.href, pathname); // sob /comercial, as telas antigas também abrem sob /comercial
        const active = pathname.startsWith(t.href) || pathname.startsWith(href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 h-14 press-scale",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className={cn("w-[22px] h-[22px] transition-all", active && "stroke-[2.4px]")} />
            <span className={cn(
              "text-[10px] leading-none tracking-tight",
              active ? "font-semibold" : "font-medium"
            )}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
