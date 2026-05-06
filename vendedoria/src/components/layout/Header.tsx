"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Menu, LogOut, User, Bell, ShoppingBag, AlertTriangle, BellOff } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { useQuery, gql } from "@apollo/client";
import { cn, getInitials } from "@/lib/utils";

const GET_ORG_ID = gql`
  query GetOrgIdForNotifications {
    whatsappBusinessOrganizations { id }
  }
`;

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  ORDER: ShoppingBag,
  ESCALATION: AlertTriangle,
  OPT_OUT: BellOff,
};

const TYPE_COLOR: Record<string, string> = {
  ORDER: "text-emerald-500",
  ESCALATION: "text-orange-500",
  OPT_OUT: "text-red-500",
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function Clock() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      setDate(now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-right hidden sm:block select-none">
      <p className="text-sm font-semibold tabular-nums text-foreground">{time}</p>
      <p className="text-[11px] text-muted-foreground capitalize">{date}</p>
    </div>
  );
}

interface HeaderProps { onToggleSidebar: () => void }

export function Header({ onToggleSidebar }: HeaderProps) {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "Usuário";
  const { data: orgData } = useQuery(GET_ORG_ID);
  const orgId = orgData?.whatsappBusinessOrganizations?.[0]?.id as string | undefined;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/notifications?organizationId=${orgId}&unread=true`);
      setNotifications(await res.json());
    } catch { /* silent */ }
  }, [orgId]);

  useEffect(() => {
    fetchNotifications();
    const t = setInterval(fetchNotifications, 15000);
    return () => clearInterval(t);
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = async () => {
    if (!orgId) return;
    await fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId }),
    });
    setNotifications([]);
  };

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 gap-4 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="text-muted-foreground hover:text-foreground rounded-lg"
        >
          <Menu className="w-4 h-4" />
        </Button>
        <div className="hidden md:block">
          <p className="text-sm text-muted-foreground">
            Bem-vindo, <span className="font-semibold text-foreground">{userName}</span>
          </p>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5">
        <Clock />

        <ThemeSwitcher />

        {/* Notification bell */}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative rounded-lg text-muted-foreground hover:text-foreground"
              onClick={fetchNotifications}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notificações</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline font-normal">
                  Marcar todas como lidas
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />
                Nenhuma notificação
              </div>
            ) : (
              notifications.slice(0, 8).map(n => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                return (
                  <DropdownMenuItem key={n.id} className="flex items-start gap-3 p-3 cursor-default">
                    <div className={cn("mt-0.5 flex-shrink-0", TYPE_COLOR[n.type] ?? "text-primary")}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body.slice(0, 100)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-lg">
              <Avatar className="w-7 h-7">
                <AvatarImage src={session?.user?.image ?? ""} alt={userName} />
                <AvatarFallback className="text-[10px] font-semibold text-white bg-emerald-700">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{userName}</p>
                <p className="text-xs leading-none text-muted-foreground">{session?.user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem><User className="mr-2 h-4 w-4" />Perfil</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="mr-2 h-4 w-4" />Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
