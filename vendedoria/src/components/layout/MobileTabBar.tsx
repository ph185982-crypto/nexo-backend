"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Kanban, LayoutDashboard, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/crm/conversations", label: "Conversas", icon: MessageSquare },
  { href: "/crm/pipeline",      label: "Pipeline",  icon: Kanban },
  { href: "/crm/dashboard",     label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm/agent",         label: "Agente",    icon: Bot },
];

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className={cn(
      "fixed bottom-0 left-0 right-0 z-50 md:hidden",
      "bg-card/95 backdrop-blur-xl border-t border-border",
      "flex h-16 safe-area-bottom",
      "shadow-[0_-1px_12px_rgba(0,0,0,0.08)]"
    )}>
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 transition-all duration-200",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <div className={cn(
              "flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200",
              active && "bg-primary/12"
            )}>
              <Icon className={cn("w-5 h-5 transition-all", active && "stroke-[2.5px]")} />
            </div>
            <span className={cn(
              "text-[10px] font-medium leading-none transition-all",
              active ? "font-semibold" : ""
            )}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
