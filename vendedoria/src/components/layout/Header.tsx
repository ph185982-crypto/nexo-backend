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

const GET_AGENT_STATUS = gql`
  query GetAgentStatus {
    whatsappBusinessOrganizations {
      id
      accounts {
        id status
        agent { id displayName status }
      }
    }
  }
`;

interface Notification {
  id: string; type: string; title: string; body: string; read: boolean; createdAt: string;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  ORDER:     ShoppingBag,
  ESCALATION: AlertTriangle,
  OPT_OUT:   BellOff,
};

const TYPE_COLOR: Record<string, string> = {
  ORDER:     "text-emerald-500",
  ESCALATION:"text-orange-500",
  OPT_OUT:   "text-red-500",
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function AgentStatusBadge() {
  const { data } = useQuery(GET_AGENT_STATUS, { fetchPolicy: "cache-and-network", pollInterval: 30000 });
  const accounts = data?.whatsappBusinessOrganizations?.flatMap(
    (o: { accounts?: Array<{ id: string; status: string; agent?: { id: string; displayName: string; status: string } | null }> }) =>
      o.accounts ?? []
  ) ?? [];
  const agent = accounts.find((a: { agent?: { status: string } | null }) => a.agent?.status === "ACTIVE")?.agent
    ?? accounts[0]?.agent;

  if (!agent) return null;

  const isActive = agent.status === "ACTIVE";

  return (
    <div className={cn(
      "hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium",
      isActive
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
        : "bg-muted border-border text-muted-foreground"
    )}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        isActive ? "bg-emerald-500 animate-pulse-dot" : "bg-gray-400"
      )} />
      <span>{agent.displayName}</span>
      <span className="opacity-60">{isActive ? "Online" : "Offline"}</span>
    </div>
  );
}

interface HeaderProps { onToggleSidebar: () => void }

export function Header({ onToggleSidebar }: HeaderProps) {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "Usuário";

  const { data: orgData } = useQuery(GET_AGENT_STATUS);
  const orgId = orgData?.whatsappBusinessOrganizations?.[0]?.id as string | undefined;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const prevCountRef = React.useRef(0);

  const playOrderSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      [523, 659, 784].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = "sine";
        g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.3);
        o.start(ctx.currentTime + i * 0.15);
        o.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
    } catch { /* no audio context */ }
  };

  const fetchNotifications = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/notifications?organizationId=${orgId}&unread=true`);
      const data: Notification[] = await res.json();
      const orderCount = data.filter(n => n.type === "ORDER").length;
      if (orderCount > prevCountRef.current) {
        playOrderSound();
        setNewOrder(true);
        setTimeout(() => setNewOrder(false), 5000);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Pedido novo!", {
            body: data.find(n => n.type === "ORDER")?.title ?? "Novo pedido recebido",
            icon: "/favicon.ico",
          });
        }
      }
      prevCountRef.current = orderCount;
      setNotifications(data);
    } catch { /* silent */ }
  }, [orgId]);

  useEffect(() => {
    fetchNotifications();
    const t = setInterval(fetchNotifications, 15000);
    return () => clearInterval(t);
  }, [fetchNotifications]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 gap-3 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost" size="icon"
          onClick={onToggleSidebar}
          className="text-muted-foreground hover:text-foreground w-8 h-8"
        >
          <Menu className="w-4 h-4" />
        </Button>
        <AgentStatusBadge />
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <ThemeSwitcher />

        {/* Notification bell */}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className={cn("relative w-8 h-8 rounded-lg", newOrder && "animate-bounce")}
              onClick={fetchNotifications}
            >
              <Bell className={cn("w-4 h-4", newOrder ? "text-emerald-500" : "text-muted-foreground")} />
              {unreadCount > 0 && (
                <span className={cn(
                  "absolute -top-0.5 -right-0.5 w-4 h-4 text-white text-[9px] font-bold rounded-full flex items-center justify-center",
                  newOrder ? "bg-emerald-500 animate-pulse" : "bg-primary"
                )}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span className="text-sm font-semibold">Notificações</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-primary hover:underline font-normal"
                >
                  Marcar lidas
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Bell className="w-6 h-6 mx-auto mb-2 opacity-20" />
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
            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg">
              <Avatar className="w-7 h-7">
                <AvatarImage src={session?.user?.image ?? ""} alt={userName} />
                <AvatarFallback className="text-[10px] font-bold bg-primary text-primary-foreground">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold leading-none">{userName}</p>
                <p className="text-xs text-muted-foreground leading-none mt-1">{session?.user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />Perfil
            </DropdownMenuItem>
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
