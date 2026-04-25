"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, CheckCircle2, XCircle, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PersonaTab }      from "./_components/PersonaTab";
import { StrategyTab }     from "./_components/StrategyTab";
import { ObjectionsTab }   from "./_components/ObjectionsTab";
import { ConstraintsTab }  from "./_components/ConstraintsTab";
import { FollowUpTab }     from "./_components/FollowUpTab";

// ─── Toast system ─────────────────────────────────────────────────────────────

type Toast = { id: string; type: "success" | "error"; message: string };

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return {
    toasts,
    success: (m: string) => add("success", m),
    error:   (m: string) => add("error", m),
  };
}

// ─── Active version badge ─────────────────────────────────────────────────────

interface VersionInfo { version: number; changeNote?: string | null; createdAt: string; }

function useActiveVersion() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch("/api/ai/versions?take=1")
      .then(r => r.json())
      .then((rows: VersionInfo[]) => { if (rows[0]) setInfo(rows[0]); })
      .catch(() => {});
  }, []);

  // re-fetch after a short delay whenever toasts fire (caller triggers via key)
  return info;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIConfigPage() {
  const toast   = useToast();
  const [versionKey, setVersionKey] = useState(0);

  // Bump version key after every save so the badge refreshes
  const handleSave = useCallback((msg: string) => {
    toast.success(msg);
    setVersionKey(k => k + 1);
  }, [toast]);

  const handleError = useCallback((msg: string) => {
    toast.error(msg);
  }, [toast]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white flex-shrink-0">
        <Brain className="w-5 h-5 text-primary flex-shrink-0" />
        <h1 className="font-semibold text-lg">Configurações da IA</h1>
        <VersionBadge key={versionKey} />
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="persona" className="flex flex-col flex-1 min-h-0">
        <div className="border-b bg-white px-4 flex-shrink-0">
          <TabsList className="h-auto bg-transparent p-0 gap-0 rounded-none">
            {[
              { value: "persona",     label: "Persona" },
              { value: "strategy",    label: "Estratégia" },
              { value: "objections",  label: "Objeções" },
              { value: "constraints", label: "Restrições" },
              { value: "followup",    label: "Follow-up" },
            ].map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  "rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium",
                  "data-[state=active]:border-primary data-[state=active]:text-primary",
                  "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  "text-muted-foreground hover:text-foreground transition-colors"
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 max-w-3xl mx-auto">
            <TabsContent value="persona"     className="mt-0 focus-visible:ring-0">
              <PersonaTab     onSave={handleSave} onError={handleError} />
            </TabsContent>
            <TabsContent value="strategy"    className="mt-0 focus-visible:ring-0">
              <StrategyTab    onSave={handleSave} onError={handleError} />
            </TabsContent>
            <TabsContent value="objections"  className="mt-0 focus-visible:ring-0">
              <ObjectionsTab  onSave={handleSave} onError={handleError} />
            </TabsContent>
            <TabsContent value="constraints" className="mt-0 focus-visible:ring-0">
              <ConstraintsTab onSave={handleSave} onError={handleError} />
            </TabsContent>
            <TabsContent value="followup"    className="mt-0 focus-visible:ring-0">
              <FollowUpTab    onSave={handleSave} onError={handleError} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      {/* ── Toast container ── */}
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toast.toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium",
              "pointer-events-auto animate-in slide-in-from-right-5 fade-in duration-300",
              t.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
            )}
          >
            {t.type === "success"
              ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Version badge (fetches independently) ───────────────────────────────────

function VersionBadge() {
  const info = useActiveVersion();

  if (!info) return null;

  return (
    <Badge
      variant="outline"
      className="ml-auto text-xs text-violet-600 border-violet-200 bg-violet-50 gap-1 flex-shrink-0"
    >
      <History className="w-3 h-3" />
      v{info.version} ativa
    </Badge>
  );
}
