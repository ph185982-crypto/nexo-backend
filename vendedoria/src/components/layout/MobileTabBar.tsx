"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Kanban, Radar, Bot, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/crm/conversations", label: "Conversas",   icon: MessageSquare },
  { href: "/crm/lead/kanban",   label: "CRM",         icon: Kanban },
  { href: "/crm/prospeccao",    label: "Prospecções", icon: Radar },
  { href: "/crm/configure-agent", label: "Agente",    icon: Bot },
  { href: "/crm/financeiro",    label: "Financeiro",  icon: Wallet },
];

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className={cn(
      "mobile-tab-bar fixed bottom-0 left-0 right-0 z-50 md:hidden",
      "bg-card/85 backdrop-blur-xl border-t border-border",
      "flex safe-area-bottom",
      "shadow-[0_-1px_12px_rgba(0,0,0,0.06)]"
    )}>
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
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
