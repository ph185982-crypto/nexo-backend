"use client";

import React, { useEffect, useState } from "react";
import { Menu, LogOut, User } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";

interface HeaderProps {
  onToggleSidebar: () => void;
}

function Clock() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
      setDate(
        now.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-right hidden sm:block">
      <p className="text-sm font-semibold text-foreground">{time}</p>
      <p className="text-xs text-muted-foreground capitalize">{date}</p>
    </div>
  );
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "Usuário";

  return (
    <header className="h-16 bg-white border-b border-border flex items-center justify-between px-4 gap-4 flex-shrink-0">
      {/* Left: Toggle + Welcome */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="text-muted-foreground"
        >
          <Menu className="w-5 h-5" />
        </Button>
        <div className="hidden md:block">
          <p className="text-sm text-muted-foreground">
            Bem vindo de volta,{" "}
            <span className="font-semibold text-foreground">{userName}</span>
          </p>
        </div>
      </div>

      {/* Right: Clock + Avatar */}
      <div className="flex items-center gap-4">
        <Clock />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="w-8 h-8">
                <AvatarImage src={session?.user?.image ?? ""} alt={userName} />
                <AvatarFallback
                  className="text-xs font-semibold text-white"
                  style={{ backgroundColor: "#004c3f" }}
                >
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{userName}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {session?.user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
