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
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-border flex h-[60px] safe-area-bottom">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              active ? "text-[var(--primaria)]" : "text-[var(--texto-terciario)]"
            )}
          >
            <Icon className={cn("w-5 h-5", active && "stroke-[2.5px]")} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
