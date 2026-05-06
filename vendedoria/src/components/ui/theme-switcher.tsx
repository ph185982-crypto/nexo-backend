"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-full text-muted-foreground hover:text-foreground"
      aria-label="Alternar tema"
    >
      <Sun className="w-4 h-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0 absolute" />
      <Moon className="w-4 h-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100 absolute" />
      <span className="sr-only">Alternar tema</span>
    </Button>
  );
}
