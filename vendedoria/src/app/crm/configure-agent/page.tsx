"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Send, Save, RotateCcw, FlaskConical, CheckCircle2,
  XCircle, ChevronDown, ChevronUp, Bot, User, Loader2,
  Clock, History, SlidersHorizontal, Zap,
} from "lucide-react";

// ── GraphQL ──────────────────────────────────────────────────────────────────

const GET_AGENTS = gql`
  query GetAgentsForConfig {
    whatsappBusinessOrganizations {
      id name
      accounts {
        id accountName displayPhoneNumber
        agent { id displayName systemPrompt aiProvider aiModel }
      }
    }
  }
`;

const SAVE_SCRIPT = gql`
  mutation SaveAgentScript($agentId: String!, $content: String!, $savedBy: String) {
    saveAgentScript(agentId: $agentId, content: $content, savedBy: $savedBy) {
      id systemPrompt
    }
  }
`;

const RESTORE_SCRIPT = gql`
  mutation RestoreAgentScript($agentId: String!, $versionId: String!) {
    restoreAgentScript(agentId: $agentId, versionId: $versionId) {
      id systemPrompt
    }
  }
`;

const GET_VERSIONS = gql`
  query GetScriptVersions($agentId: String!) {
    agentScriptVersions(agentId: $agentId) {
      id content savedBy createdAt
    }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  displayName: string;
  systemPrompt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
}

interface Account {
  id: string;
  accountName: string;
  displayPhoneNumber?: string | null;
  agent?: Agent | null;
}

interface Org {
  id: string;
  name: string;
  accounts: Account[];
}

interface ScriptVersion {
  id: string;
  content: string;
  savedBy?: string | null;
  createdAt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface TestResult {
  balloons: string[];
  ruleActivated: string | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ConfigureAgentPage() {
  // Agent selection
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "opa! sou o configurador do agente Pedro 👋\n\nme conta o que você quer mudar — pode ser o tom, o roteiro de fechamento, os preços, ou qualquer coisa. o que tá incomodando?",
      timestamp: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Script editor state
  const [scriptContent, setScriptContent] = useState("");
  const [scriptModified, setScriptModified] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Test state
  const [testInput, setTestInput] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Versions panel
  const [showVersions, setShowVersions] = useState(false);

  // Mobile panel toggle
  const [mobilePanel, setMobilePanel] = useState<"chat" | "editor" | "test">("chat");

  // Queries & Mutations
  const { data: orgsData, loading: orgsLoading } = useQuery<{ whatsappBusinessOrganizations: Org[] }>(GET_AGENTS, {
    fetchPolicy: "cache-and-network",
  });

  const { data: versionsData, refetch: refetchVersions } = useQuery<{ agentScriptVersions: ScriptVersion[] }>(
    GET_VERSIONS,
    { variables: { agentId: selectedAgentId ?? "" }, skip: !selectedAgentId, fetchPolicy: "cache-and-network" }
  );

  const [saveScript] = useMutation(SAVE_SCRIPT);
  const [restoreScript] = useMutation(RESTORE_SCRIPT);

  // Flatten agents from orgs
  const allAgents: Array<{ agent: Agent; account: Account; org: Org }> = [];
  (orgsData?.whatsappBusinessOrganizations ?? []).forEach((org) => {
    org.accounts.forEach((acc) => {
      if (acc.agent) allAgents.push({ agent: acc.agent, account: acc, org });
    });
  });

  // Auto-select first agent
  useEffect(() => {
    if (allAgents.length > 0 && !selectedAgentId) {
      const first = allAgents[0];
      setSelectedAgentId(first.agent.id);
      setSelectedAgent(first.agent);
      setScriptContent(first.agent.systemPrompt ?? "");
    }
  }, [allAgents.length, selectedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Select agent
  const handleSelectAgent = useCallback((entry: { agent: Agent }) => {
    setSelectedAgentId(entry.agent.id);
    setSelectedAgent(entry.agent);
    setScriptContent(entry.agent.systemPrompt ?? "");
    setScriptModified(false);
    setTestResult(null);
  }, []);

  // Send chat message
  const handleSendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: new Date() };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const history = [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/agent-config/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, agentId: selectedAgentId }),
      });
      const data = await res.json() as { response?: string; error?: string };
      const assistantContent = data.response ?? "desculpa, não consegui responder agora";

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: assistantContent, timestamp: new Date() },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "erro de conexão, tenta de novo", timestamp: new Date() },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatMessages, selectedAgentId]);

  // Save script
  const handleSaveScript = useCallback(async () => {
    if (!selectedAgentId || savingScript) return;
    setSavingScript(true);
    try {
      await saveScript({ variables: { agentId: selectedAgentId, content: scriptContent, savedBy: "editor" } });
      setScriptModified(false);
      setSaveSuccess(true);
      await refetchVersions();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingScript(false);
    }
  }, [selectedAgentId, savingScript, scriptContent, saveScript, refetchVersions]);

  // Restore version
  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!selectedAgentId) return;
    if (!confirm("Restaurar esta versão? O script atual será salvo no histórico.")) return;
    try {
      const result = await restoreScript({ variables: { agentId: selectedAgentId, versionId } });
      const newScript = result.data?.restoreAgentScript?.systemPrompt ?? "";
      setScriptContent(newScript);
      setScriptModified(false);
      await refetchVersions();
    } catch (e) {
      console.error(e);
    }
  }, [selectedAgentId, restoreScript, refetchVersions]);

  // Quick test
  const handleTest = useCallback(async () => {
    const msg = testInput.trim();
    if (!msg || !selectedAgentId || testLoading) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/agent-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentId,
          message: msg,
          customScript: scriptModified ? scriptContent : undefined,
        }),
      });
      const data = await res.json() as TestResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setTestResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setTestLoading(false);
    }
  }, [testInput, selectedAgentId, testLoading, scriptModified, scriptContent]);

  // Apply test result to script
  const handleApplyTest = useCallback(async () => {
    if (!selectedAgentId || !testResult) return;
    await handleSaveScript();
    setTestResult(null);
    setTestInput("");
  }, [selectedAgentId, testResult, handleSaveScript]);

  const versions = versionsData?.agentScriptVersions ?? [];

  if (orgsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (allAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <Bot className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Nenhum agente configurado</h2>
        <p className="text-muted-foreground">Adicione uma conta WhatsApp com agente ativo nas Configurações.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white flex-shrink-0">
        <SlidersHorizontal className="w-5 h-5 text-primary" />
        <h1 className="font-semibold text-lg">Configurar Agente</h1>

        {/* Agent selector */}
        {allAgents.length > 1 && (
          <select
            className="ml-2 text-sm border rounded-md px-2 py-1 bg-background"
            value={selectedAgentId ?? ""}
            onChange={(e) => {
              const entry = allAgents.find((a) => a.agent.id === e.target.value);
              if (entry) handleSelectAgent(entry);
            }}
          >
            {allAgents.map(({ agent, account, org }) => (
              <option key={agent.id} value={agent.id}>
                {org.name} — {account.accountName} ({agent.displayName})
              </option>
            ))}
          </select>
        )}

        {selectedAgent && (
          <Badge variant="outline" className="ml-auto text-xs text-emerald-600 border-emerald-200 bg-emerald-50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 inline-block" />
            {selectedAgent.displayName} · ativo
          </Badge>
        )}
      </div>

      {/* ── Mobile panel toggle ── */}
      <div className="flex md:hidden border-b bg-white flex-shrink-0">
        {(["chat", "editor", "test"] as const).map((panel) => (
          <button
            key={panel}
            onClick={() => setMobilePanel(panel)}
            className={cn(
              "flex-1 py-2 text-xs font-medium transition-colors",
              mobilePanel === panel
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {panel === "chat" ? "🤖 Configurador" : panel === "editor" ? "📝 Script" : "⚡ Teste"}
          </button>
        ))}
      </div>

      {/* ── Main 3-column layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ══ LEFT: CHAT ══════════════════════════════════════════════════════ */}
        <div className={cn(
          "flex flex-col border-r bg-white",
          "w-full md:w-[42%] lg:w-[40%]",
          mobilePanel !== "chat" && "hidden md:flex"
        )}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-gray-50 flex-shrink-0">
            <Bot className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Chat com o Configurador</span>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={cn("flex gap-2 max-w-full", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
                >
                  <div className={cn(
                    "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs",
                    msg.role === "user" ? "bg-primary" : "bg-emerald-500"
                  )}>
                    {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>
                  <div className={cn(
                    "flex flex-col gap-0.5 max-w-[80%]",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
                      msg.role === "user"
                        ? "bg-primary text-white rounded-tr-sm"
                        : "bg-gray-100 text-gray-800 rounded-tl-sm"
                    )}>
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground px-1">
                      {msg.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          </ScrollArea>

          {/* Chat input */}
          <div className="p-3 border-t bg-white flex-shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="ex: quero que o agente pare de pedir localização..."
                className="min-h-[44px] max-h-[120px] resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
                }}
              />
              <Button
                size="icon"
                onClick={handleSendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="h-11 w-11 flex-shrink-0"
              >
                {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Enter para enviar · Shift+Enter para nova linha</p>
          </div>
        </div>

        {/* ══ RIGHT: EDITOR + TEST ════════════════════════════════════════════ */}
        <div className={cn(
          "flex flex-col flex-1 min-w-0",
          (mobilePanel === "editor" || mobilePanel === "test") ? "flex" : "hidden md:flex"
        )}>

          {/* ── Script Editor ── */}
          <div className={cn(
            "flex flex-col border-b bg-white",
            mobilePanel === "test" ? "hidden md:flex md:flex-1" : "flex-1",
            "min-h-0"
          )}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-gray-50 flex-shrink-0">
              <span className="text-sm font-medium flex-1">Script Atual do Agente</span>

              {scriptModified && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50">
                  modificado
                </Badge>
              )}
              {saveSuccess && (
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 bg-emerald-50">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> salvo!
                </Badge>
              )}

              {/* History toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowVersions((v) => !v)}
                className="text-xs h-7 gap-1"
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Histórico</span>
                {showVersions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>

              <Button
                size="sm"
                onClick={handleSaveScript}
                disabled={!scriptModified || savingScript || !selectedAgentId}
                className="h-7 text-xs gap-1"
              >
                {savingScript ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            </div>

            {/* Version history panel */}
            {showVersions && (
              <div className="border-b bg-gray-50 max-h-52 overflow-y-auto flex-shrink-0">
                {versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3">Nenhuma versão salva ainda.</p>
                ) : (
                  <div className="divide-y">
                    {versions.map((v, i) => (
                      <div key={v.id} className="flex items-start gap-3 px-3 py-2 hover:bg-gray-100 group">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700">
                            {i === 0 ? "Versão anterior" : `Versão ${versions.length - i}`}
                            {v.savedBy && <span className="text-muted-foreground font-normal"> · {v.savedBy}</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)}</p>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{v.content.substring(0, 80)}…</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestoreVersion(v.id)}
                          className="h-6 text-[11px] opacity-0 group-hover:opacity-100 gap-1 flex-shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restaurar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Textarea */}
            <div className="flex-1 min-h-0 p-3">
              <Textarea
                value={scriptContent}
                onChange={(e) => {
                  setScriptContent(e.target.value);
                  setScriptModified(e.target.value !== (selectedAgent?.systemPrompt ?? ""));
                }}
                placeholder="O script do agente aparece aqui. Selecione um agente acima."
                className="h-full resize-none font-mono text-xs leading-relaxed"
              />
            </div>

            <div className="px-4 py-1.5 border-t bg-gray-50 flex-shrink-0 flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">
                {scriptContent.length} chars · {scriptContent.split("\n").length} linhas
              </span>
              {scriptModified && (
                <button
                  onClick={() => { setScriptContent(selectedAgent?.systemPrompt ?? ""); setScriptModified(false); }}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                  descartar mudanças
                </button>
              )}
            </div>
          </div>

          {/* ── Quick Test ── */}
          <div className={cn(
            "flex flex-col bg-white flex-shrink-0",
            mobilePanel === "test" ? "flex-1" : "h-auto max-h-[45%]"
          )}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-gray-50 flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium">Teste Rápido</span>
              {scriptModified && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50 ml-1">
                  testando versão local (não salva)
                </Badge>
              )}
            </div>

            <div className="p-3 flex gap-2 flex-shrink-0">
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Simule uma mensagem do cliente, ex: oi quero saber sobre a 48v"
                className="min-h-[44px] max-h-[80px] resize-none text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTest(); }
                }}
              />
              <Button
                onClick={handleTest}
                disabled={testLoading || !testInput.trim() || !selectedAgentId}
                className="h-11 gap-1.5 flex-shrink-0 bg-violet-600 hover:bg-violet-700"
              >
                {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                <span className="hidden sm:inline">Testar</span>
              </Button>
            </div>

            {testResult && (
              <div className="mx-3 mb-3 rounded-xl border bg-gray-50 overflow-hidden flex-shrink-0">
                {/* Balloons preview */}
                <div className="p-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Como o agente responderia:
                  </p>
                  {testResult.balloons.map((balloon, i) => (
                    <div key={i} className="flex justify-end">
                      <div className="bg-[#dcf8c6] text-gray-800 px-3 py-1.5 rounded-2xl rounded-tr-sm text-sm max-w-[85%] shadow-sm">
                        {balloon}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Rule activated */}
                {testResult.ruleActivated && (
                  <div className="px-3 py-2 border-t bg-white">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-violet-600">Regra ativada:</span>{" "}
                      {testResult.ruleActivated}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 p-2 border-t bg-white">
                  <Button
                    size="sm"
                    onClick={handleApplyTest}
                    className="flex-1 h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Está bom, salvar script
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTestResult(null)}
                    className="h-8 text-xs gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Ajustar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
