"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bot, FileText, TestTube2, Settings2, Save, RotateCcw, Send, Loader2, CheckCircle, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PromptHistory { id: string; version: number; savedBy: string; createdAt: string; content: string }
interface AgentConfig {
  agentName: string; bastaoNumber: string;
  deliveryWeekStart: number; deliveryWeekEnd: number;
  deliverySatStart: number; deliverySatEnd: number;
  maxFollowUps: number; followUpHours: string; deliveryArea: string;
}
interface ChatMsg { role: "user" | "assistant"; content: string }

const TABS = [
  { id: "roteiro",  label: "💬 Roteiro",    icon: FileText },
  { id: "ia",       label: "🤖 Ajustar com IA", icon: Bot },
  { id: "testar",   label: "🧪 Testar",     icon: TestTube2 },
  { id: "config",   label: "⚙️ Config",     icon: Settings2 },
] as const;
type Tab = typeof TABS[number]["id"];

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 shadow-lg">
      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
      {msg}
      <button onClick={onClose}><X className="w-3.5 h-3.5 opacity-60 hover:opacity-100" /></button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AgentPage() {
  const [tab, setTab] = useState<Tab>("roteiro");
  const [toast, setToast] = useState("");

  // Roteiro state
  const [prompt, setPrompt] = useState("");
  const [promptVersion, setPromptVersion] = useState(1);
  const [promptUpdatedAt, setPromptUpdatedAt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<PromptHistory | null>(null);

  // IA chat state
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Test state
  const [testInput, setTestInput] = useState("");
  const [testMessages, setTestMessages] = useState<string[]>([]);
  const [testLoading, setTestLoading] = useState(false);

  // Config state
  const [config, setConfig] = useState<AgentConfig>({
    agentName: "Léo", bastaoNumber: "5562984465388",
    deliveryWeekStart: 9, deliveryWeekEnd: 18,
    deliverySatStart: 8, deliverySatEnd: 13,
    maxFollowUps: 4, followUpHours: "4,24,48,72",
    deliveryArea: "Goiânia",
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Load prompt + config on mount ──────────────────────────────────────────
  useEffect(() => {
    fetch("/api/agent/prompt").then(r => r.json()).then((d: { content: string; version: number; updatedAt: string }) => {
      setPrompt(d.content ?? "");
      setPromptVersion(d.version ?? 1);
      setPromptUpdatedAt(d.updatedAt ?? "");
    }).catch(() => {});

    fetch("/api/agent/config").then(r => r.json()).then((d: AgentConfig) => {
      if (d && d.agentName) setConfig(d);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // ── Roteiro: save ──────────────────────────────────────────────────────────
  const savePrompt = useCallback(async () => {
    setSavingPrompt(true);
    try {
      const r = await fetch("/api/agent/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: prompt, savedBy: "Pedro" }),
      });
      const d = await r.json() as { version: number; updatedAt: string };
      setPromptVersion(d.version);
      setPromptUpdatedAt(d.updatedAt);
      setToast(`✅ Roteiro salvo — v.${d.version}`);
    } finally { setSavingPrompt(false); }
  }, [prompt]);

  // ── Roteiro: history ───────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    const r = await fetch("/api/agent/prompt/history");
    const d = await r.json() as PromptHistory[];
    setHistory(d);
    setShowHistory(true);
  }, []);

  const restoreVersion = useCallback(async (version: number) => {
    const r = await fetch("/api/agent/prompt/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    const d = await r.json() as { version: number };
    // Reload prompt
    const pr = await fetch("/api/agent/prompt");
    const pd = await pr.json() as { content: string; version: number; updatedAt: string };
    setPrompt(pd.content);
    setPromptVersion(d.version);
    setToast(`✅ Versão ${version} restaurada como v.${d.version}`);
    setShowHistory(false);
  }, []);

  // ── IA chat ────────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    const newHistory: ChatMsg[] = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(newHistory);
    setChatLoading(true);
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: chatHistory }),
      });
      const d = await r.json() as { response: string; patchAplicado: boolean; newVersion?: number };
      setChatHistory([...newHistory, { role: "assistant", content: d.response }]);
      if (d.patchAplicado && d.newVersion) {
        setToast(`✅ Roteiro atualizado — v.${d.newVersion} ativo`);
        setPromptVersion(d.newVersion);
        // Reload prompt
        const pr = await fetch("/api/agent/prompt");
        const pd = await pr.json() as { content: string; version: number; updatedAt: string };
        setPrompt(pd.content);
        setPromptUpdatedAt(pd.updatedAt);
      }
    } catch { setChatHistory([...newHistory, { role: "assistant", content: "Erro ao contatar a IA." }]); }
    finally { setChatLoading(false); }
  }, [chatInput, chatHistory, chatLoading]);

  // ── Test ───────────────────────────────────────────────────────────────────
  const runTest = useCallback(async () => {
    if (!testInput.trim() || testLoading) return;
    setTestMessages([]);
    setTestLoading(true);
    try {
      const r = await fetch("/api/agent/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testInput }),
      });
      const d = await r.json() as { messages: string[] };
      setTestMessages(d.messages ?? []);
    } finally { setTestLoading(false); }
  }, [testInput, testLoading]);

  // ── Config: save ───────────────────────────────────────────────────────────
  const saveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      await fetch("/api/agent/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setToast("✅ Configurações salvas");
    } finally { setSavingConfig(false); }
  }, [config]);

  const fmtDate = (d: string) => d ? new Date(d).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--fundo)]">
      {toast && <Toast msg={toast} onClose={() => setToast("")} />}

      {/* Tabs */}
      <div className="bg-white border-b flex overflow-x-auto scrollbar-none shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              tab === t.id
                ? "border-[var(--primaria)] text-[var(--primaria)]"
                : "border-transparent text-[var(--texto-secundario)] hover:text-[var(--texto)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Roteiro ─────────────────────────────────────────────────────── */}
      {tab === "roteiro" && (
        <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-[var(--texto)]">Roteiro do Agente</h2>
              <p className="text-xs text-[var(--texto-secundario)]">
                v.{promptVersion}{promptUpdatedAt ? ` · salvo ${fmtDate(promptUpdatedAt)}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadHistory} className="gap-1.5 text-xs">
                <RotateCcw className="w-3.5 h-3.5" /> Histórico
              </Button>
              <Button size="sm" onClick={savePrompt} disabled={savingPrompt} className="gap-1.5 text-xs bg-[var(--primaria)] hover:bg-[var(--primaria)]/90">
                {savingPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            </div>
          </div>

          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="flex-1 min-h-[300px] font-mono text-xs resize-none"
            placeholder="Roteiro do agente..."
          />

          {/* History modal */}
          {showHistory && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4" onClick={() => setShowHistory(false)}>
              <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b">
                  <h3 className="font-semibold">Histórico de versões</h3>
                  <button onClick={() => setShowHistory(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {history.length === 0 && (
                    <p className="text-sm text-center py-8 text-[var(--texto-secundario)]">Nenhuma versão anterior</p>
                  )}
                  {history.map((h) => (
                    <div key={h.id} className="border-b px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">v.{h.version} — {h.savedBy}</p>
                        <p className="text-xs text-[var(--texto-secundario)]">{fmtDate(h.createdAt)}</p>
                      </div>
                      <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={() => setHistoryDetail(h)}>Ver</Button>
                      <Button size="sm" className="text-xs shrink-0 bg-[var(--primaria)]" onClick={() => void restoreVersion(h.version)}>Restaurar</Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* History detail modal */}
          {historyDetail && (
            <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setHistoryDetail(null)}>
              <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b">
                  <h3 className="font-semibold">v.{historyDetail.version} — {fmtDate(historyDetail.createdAt)}</h3>
                  <button onClick={() => setHistoryDetail(null)}><X className="w-4 h-4" /></button>
                </div>
                <pre className="overflow-auto flex-1 p-4 text-xs font-mono whitespace-pre-wrap">{historyDetail.content}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: IA Chat ─────────────────────────────────────────────────────── */}
      {tab === "ia" && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatHistory.length === 0 && (
              <div className="text-center py-12 text-[var(--texto-secundario)]">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Descreva a mudança que quer fazer no roteiro do agente.</p>
                <p className="text-xs mt-1 opacity-60">Ex: "quero que ele seja mais direto ao falar o preço"</p>
              </div>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-[var(--primaria)] text-white rounded-tr-sm"
                    : "bg-white border text-[var(--texto)] rounded-tl-sm shadow-sm"
                )}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--texto-secundario)]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t p-3 flex gap-2 items-end shrink-0">
            <Textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Descreva o que quer mudar..."
              rows={1}
              className="flex-1 min-h-[42px] max-h-32 resize-none text-sm"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
            />
            <Button size="icon" onClick={() => void sendChat()} disabled={chatLoading || !chatInput.trim()}
              className="h-11 w-11 shrink-0 rounded-full bg-[var(--primaria)]">
              {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* ── Tab: Testar ──────────────────────────────────────────────────────── */}
      {tab === "testar" && (
        <div className="flex flex-col flex-1 min-h-0 p-4 gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
            <TestTube2 className="w-3.5 h-3.5 shrink-0" />
            Modo de teste — nada é enviado para o WhatsApp
          </div>

          <div className="flex gap-2">
            <Input
              value={testInput}
              onChange={e => setTestInput(e.target.value)}
              placeholder="Simule uma mensagem do cliente..."
              className="flex-1"
              onKeyDown={e => { if (e.key === "Enter") void runTest(); }}
            />
            <Button onClick={() => void runTest()} disabled={testLoading || !testInput.trim()}
              className="bg-[var(--primaria)] gap-1.5">
              {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Testar
            </Button>
          </div>

          {testMessages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--texto-secundario)] font-medium">Resposta do agente:</p>
              {testMessages.map((m, i) => (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-[#dcf8c6] rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm shadow-sm">
                    {m}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Config ──────────────────────────────────────────────────────── */}
      {tab === "config" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-lg mx-auto space-y-4">
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <h3 className="font-semibold text-sm">Identidade do agente</h3>
              <label className="block">
                <span className="text-xs text-[var(--texto-secundario)]">Nome do agente</span>
                <Input value={config.agentName} onChange={e => setConfig(c => ({ ...c, agentName: e.target.value }))} className="mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--texto-secundario)]">Número do bastão (Pedro)</span>
                <Input value={config.bastaoNumber} onChange={e => setConfig(c => ({ ...c, bastaoNumber: e.target.value }))} className="mt-1" />
              </label>
            </div>

            <div className="bg-white rounded-xl border p-4 space-y-3">
              <h3 className="font-semibold text-sm">Horário de entrega</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-[var(--texto-secundario)]">Seg-Sex início (h)</span>
                  <Input type="number" min={0} max={23} value={config.deliveryWeekStart}
                    onChange={e => setConfig(c => ({ ...c, deliveryWeekStart: +e.target.value }))} className="mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs text-[var(--texto-secundario)]">Seg-Sex fim (h)</span>
                  <Input type="number" min={0} max={23} value={config.deliveryWeekEnd}
                    onChange={e => setConfig(c => ({ ...c, deliveryWeekEnd: +e.target.value }))} className="mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs text-[var(--texto-secundario)]">Sábado início (h)</span>
                  <Input type="number" min={0} max={23} value={config.deliverySatStart}
                    onChange={e => setConfig(c => ({ ...c, deliverySatStart: +e.target.value }))} className="mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs text-[var(--texto-secundario)]">Sábado fim (h)</span>
                  <Input type="number" min={0} max={23} value={config.deliverySatEnd}
                    onChange={e => setConfig(c => ({ ...c, deliverySatEnd: +e.target.value }))} className="mt-1" />
                </label>
              </div>
            </div>

            <div className="bg-white rounded-xl border p-4 space-y-3">
              <h3 className="font-semibold text-sm">Follow-up</h3>
              <label className="block">
                <span className="text-xs text-[var(--texto-secundario)]">Máximo de follow-ups</span>
                <Input type="number" min={1} max={10} value={config.maxFollowUps}
                  onChange={e => setConfig(c => ({ ...c, maxFollowUps: +e.target.value }))} className="mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--texto-secundario)]">Intervalos (horas, separados por vírgula)</span>
                <Input value={config.followUpHours} onChange={e => setConfig(c => ({ ...c, followUpHours: e.target.value }))} className="mt-1" placeholder="4,24,48,72" />
              </label>
            </div>

            <div className="bg-white rounded-xl border p-4 space-y-3">
              <h3 className="font-semibold text-sm">Área de entrega</h3>
              <p className="text-xs text-[var(--texto-secundario)]">Uma cidade por linha</p>
              <Textarea
                value={config.deliveryArea.split(",").join("\n")}
                onChange={e => setConfig(c => ({ ...c, deliveryArea: e.target.value.split("\n").join(",") }))}
                rows={6}
                className="text-sm"
              />
            </div>

            <Button onClick={() => void saveConfig()} disabled={savingConfig} className="w-full bg-[var(--primaria)] gap-2">
              {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar configurações
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
