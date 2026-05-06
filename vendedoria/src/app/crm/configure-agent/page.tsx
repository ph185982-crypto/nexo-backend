"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Save, RotateCcw, FlaskConical, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Bot, User, Loader2, Clock,
  History, Zap, Smile, MessageCircle, Target, Shield,
  AlertTriangle, Plus, Trash2, Send, Brain, Settings2,
  TrendingUp, Mic, Timer, ChevronRight,
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

interface ObjecaoEntry { palavraChave: string; estrategia: string; exemplo: string }

interface FullAiConfig {
  usarEmoji: boolean;
  usarReticencias: boolean;
  nivelVenda: string;
  tomDeVoz: string;
  arquetipoIA: string | null;
  objetivoVenda: string;
  nivelUrgencia: number;
  matrizObjecoes: ObjecaoEntry[];
  restricoes: string[];
  followUpIntervalos: number[];
  followUpMaxTentativas: number;
}

const CONFIG_DEFAULTS: FullAiConfig = {
  usarEmoji: true,
  usarReticencias: true,
  nivelVenda: "medio",
  tomDeVoz: "sincero",
  arquetipoIA: null,
  objetivoVenda: "fechar_venda",
  nivelUrgencia: 3,
  matrizObjecoes: [],
  restricoes: [],
  followUpIntervalos: [4, 24, 48, 72],
  followUpMaxTentativas: 4,
};

interface Agent {
  id: string; displayName: string; systemPrompt?: string | null;
  aiProvider?: string | null; aiModel?: string | null;
}
interface Account { id: string; accountName: string; displayPhoneNumber?: string | null; agent?: Agent | null }
interface Org { id: string; name: string; accounts: Account[] }
interface ScriptVersion { id: string; content: string; savedBy?: string | null; createdAt: string }
interface ChatMessage { role: "user" | "assistant"; content: string; timestamp: Date }
interface TestResult { balloons: string[]; ruleActivated: string | null }

type Module = "persona" | "estrategia" | "objecoes" | "restricoes" | "followup" | "script";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULE_META: Array<{ id: Module; icon: React.ElementType; label: string; desc: string }> = [
  { id: "persona",    icon: Mic,         label: "Persona",      desc: "Tom, arquétipo e identidade da IA" },
  { id: "estrategia", icon: Target,       label: "Estratégia",   desc: "Objetivo de venda e urgência" },
  { id: "objecoes",   icon: AlertTriangle,label: "Objeções",     desc: "Matriz de respostas a objeções" },
  { id: "restricoes", icon: Shield,       label: "Restrições",   desc: "O que a IA NUNCA deve fazer" },
  { id: "followup",   icon: Timer,        label: "Follow-up",    desc: "Intervalos e tentativas" },
  { id: "script",     icon: Brain,        label: "Script",       desc: "Roteiro base do agente" },
];

const TOM_OPTIONS = [
  { value: "sincero",    label: "Sincero",    desc: "Autêntico e transparente. Acredita no produto.", color: "border-emerald-500 text-emerald-400 bg-emerald-950/40" },
  { value: "agressivo",  label: "Agressivo",  desc: "Direto ao fechamento. Urgência real. Assertivo.", color: "border-orange-500 text-orange-400 bg-orange-950/40" },
  { value: "consultivo", label: "Consultivo", desc: "Faz perguntas. Entende a necessidade. Recomenda.", color: "border-blue-500 text-blue-400 bg-blue-950/40" },
];

const OBJETIVO_OPTIONS = [
  { value: "fechar_venda", label: "🎯 Fechar Venda",  desc: "Objetivo único: pedido nesta conversa" },
  { value: "gerar_lead",   label: "📋 Gerar Lead",    desc: "Coletar nome + telefone + horário para visita" },
  { value: "qualificar",   label: "🔍 Qualificar",    desc: "Identificar perfil antes de investir esforço" },
];

const NIVEL_OPTIONS = [
  { value: "leve",      label: "Suave",       color: "border-blue-500 text-blue-400 bg-blue-950/40" },
  { value: "medio",     label: "Equilibrado", color: "border-emerald-500 text-emerald-400 bg-emerald-950/40" },
  { value: "agressivo", label: "Agressivo",   color: "border-orange-500 text-orange-400 bg-orange-950/40" },
];

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ConfigureAgentPage() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent]     = useState<Agent | null>(null);
  const [selectedOrgId, setSelectedOrgId]     = useState<string | null>(null);

  const [config, setConfig]           = useState<FullAiConfig>(CONFIG_DEFAULTS);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved]   = useState(false);

  const [activeModule, setActiveModule] = useState<Module>("persona");

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: "assistant",
    content: "opa! sou o configurador do agente 👋\nme conta o que você quer mudar — tom, roteiro, preços. o que tá incomodando?",
    timestamp: new Date(),
  }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Script editor
  const [scriptContent, setScriptContent]   = useState("");
  const [scriptModified, setScriptModified] = useState(false);
  const [savingScript, setSavingScript]     = useState(false);
  const [saveSuccess, setSaveSuccess]       = useState(false);
  const [showVersions, setShowVersions]     = useState(false);

  // Quick test
  const [testInput, setTestInput]     = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult]   = useState<TestResult | null>(null);

  // Mobile
  const [mobileView, setMobileView] = useState<"modules" | "chat" | "test">("modules");

  const { data: orgsData, loading: orgsLoading } = useQuery<{ whatsappBusinessOrganizations: Org[] }>(GET_AGENTS, { fetchPolicy: "cache-and-network" });
  const { data: versionsData, refetch: refetchVersions } = useQuery<{ agentScriptVersions: ScriptVersion[] }>(GET_VERSIONS, { variables: { agentId: selectedAgentId ?? "" }, skip: !selectedAgentId, fetchPolicy: "cache-and-network" });
  const [saveScript]     = useMutation(SAVE_SCRIPT);
  const [restoreScript]  = useMutation(RESTORE_SCRIPT);

  const allAgents: Array<{ agent: Agent; account: Account; org: Org }> = [];
  (orgsData?.whatsappBusinessOrganizations ?? []).forEach((org) => {
    org.accounts.forEach((acc) => { if (acc.agent) allAgents.push({ agent: acc.agent, account: acc, org }); });
  });

  const loadConfig = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/config?organizationId=${orgId}`);
      if (!res.ok) return;
      const raw = await res.json() as Partial<FullAiConfig>;
      setConfig({
        ...CONFIG_DEFAULTS,
        ...raw,
        matrizObjecoes: Array.isArray(raw.matrizObjecoes) ? (raw.matrizObjecoes as ObjecaoEntry[]) : [],
        restricoes:     Array.isArray(raw.restricoes)     ? (raw.restricoes as string[]) : [],
        followUpIntervalos: Array.isArray(raw.followUpIntervalos) ? (raw.followUpIntervalos as number[]) : [4,24,48,72],
      });
    } catch { /* use defaults */ }
  }, []);

  const persistConfig = useCallback(async (patch: Partial<FullAiConfig>, orgId: string | null) => {
    if (!orgId) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setConfigSaving(true);
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId, ...next, savedBy: "dashboard" }),
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2500);
    } catch { /* silent */ }
    finally { setConfigSaving(false); }
  }, [config]);

  useEffect(() => {
    if (allAgents.length > 0 && !selectedAgentId) {
      const first = allAgents[0];
      setSelectedAgentId(first.agent.id);
      setSelectedAgent(first.agent);
      setSelectedOrgId(first.org.id);
      setScriptContent(first.agent.systemPrompt ?? "");
      loadConfig(first.org.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAgents.length, selectedAgentId]);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const handleSelectAgent = useCallback((entry: { agent: Agent; org: Org }) => {
    setSelectedAgentId(entry.agent.id);
    setSelectedAgent(entry.agent);
    setSelectedOrgId(entry.org.id);
    setScriptContent(entry.agent.systemPrompt ?? "");
    setScriptModified(false);
    setTestResult(null);
    loadConfig(entry.org.id);
  }, [loadConfig]);

  const handleSendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: new Date() };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/agent-config/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content })), agentId: selectedAgentId }),
      });
      const data = await res.json() as { response?: string };
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.response ?? "desculpa, não consegui responder", timestamp: new Date() }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "erro de conexão, tenta de novo", timestamp: new Date() }]);
    } finally { setChatLoading(false); }
  }, [chatInput, chatLoading, chatMessages, selectedAgentId]);

  const handleSaveScript = useCallback(async () => {
    if (!selectedAgentId || savingScript) return;
    setSavingScript(true);
    try {
      await saveScript({ variables: { agentId: selectedAgentId, content: scriptContent, savedBy: "editor" } });
      setScriptModified(false); setSaveSuccess(true);
      await refetchVersions();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) { console.error(e); }
    finally { setSavingScript(false); }
  }, [selectedAgentId, savingScript, scriptContent, saveScript, refetchVersions]);

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!selectedAgentId) return;
    if (!confirm("Restaurar esta versão?")) return;
    try {
      const result = await restoreScript({ variables: { agentId: selectedAgentId, versionId } });
      setScriptContent(result.data?.restoreAgentScript?.systemPrompt ?? "");
      setScriptModified(false);
      await refetchVersions();
    } catch (e) { console.error(e); }
  }, [selectedAgentId, restoreScript, refetchVersions]);

  const handleTest = useCallback(async () => {
    const msg = testInput.trim();
    if (!msg || !selectedAgentId || testLoading) return;
    setTestLoading(true); setTestResult(null);
    try {
      const res = await fetch("/api/agent-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId, message: msg, customScript: scriptModified ? scriptContent : undefined }),
      });
      const data = await res.json() as TestResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setTestResult(data);
    } catch (e) { console.error(e); }
    finally { setTestLoading(false); }
  }, [testInput, selectedAgentId, testLoading, scriptModified, scriptContent]);

  const versions = versionsData?.agentScriptVersions ?? [];

  if (orgsLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (allAgents.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <Bot className="w-16 h-16 text-muted-foreground" />
      <h2 className="text-xl font-semibold">Nenhum agente configurado</h2>
      <p className="text-muted-foreground">Adicione uma conta WhatsApp com agente ativo nas Configurações.</p>
    </div>
  );

  // ── Render Module Panel ───────────────────────────────────────────────────

  const renderModulePanel = () => {
    switch (activeModule) {

      // ── Módulo 1: Persona ───────────────────────────────────────────────
      case "persona": return (
        <div className="space-y-6">
          <ModuleHeader icon={Mic} title="Persona da IA" desc="Defina a identidade, tom de voz e arquétipo do agente" />

          {/* Tom de Voz */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tom de Voz</label>
            <div className="grid grid-cols-1 gap-2">
              {TOM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => persistConfig({ tomDeVoz: opt.value }, selectedOrgId)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all",
                    config.tomDeVoz === opt.value ? opt.color : "border-border bg-card hover:border-muted-foreground/30"
                  )}
                >
                  <div className="w-4 h-4 mt-0.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                    style={{ borderColor: "currentColor" }}>
                    {config.tomDeVoz === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Arquétipo */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Arquétipo / Persona (opcional)
            </label>
            <Input
              value={config.arquetipoIA ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, arquetipoIA: e.target.value || null }))}
              onBlur={() => persistConfig({ arquetipoIA: config.arquetipoIA }, selectedOrgId)}
              placeholder="ex: Léo, o especialista em energia solar — direto e confiante"
              className="bg-card border-border text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Define personalidade e nome do agente. Injeta no prompt como instrução de identidade.</p>
          </div>

          {/* Micro-comportamentos */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Micro-comportamentos</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                <div className="flex items-center gap-2">
                  <Smile className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className="text-xs font-medium">Emojis</p>
                    <p className="text-[10px] text-muted-foreground">Máx 1 por msg</p>
                  </div>
                </div>
                <Switch
                  checked={config.usarEmoji}
                  onCheckedChange={(v) => persistConfig({ usarEmoji: v }, selectedOrgId)}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="text-xs font-medium">Reticências</p>
                    <p className="text-[10px] text-muted-foreground">Pausas naturais</p>
                  </div>
                </div>
                <Switch
                  checked={config.usarReticencias}
                  onCheckedChange={(v) => persistConfig({ usarReticencias: v }, selectedOrgId)}
                />
              </div>
            </div>
          </div>
        </div>
      );

      // ── Módulo 2: Estratégia ────────────────────────────────────────────
      case "estrategia": return (
        <div className="space-y-6">
          <ModuleHeader icon={Target} title="Estratégia de Venda" desc="Objetivo, nível de urgência e estilo de condução" />

          {/* Objetivo de Venda */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Objetivo de Venda</label>
            <div className="space-y-2">
              {OBJETIVO_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => persistConfig({ objetivoVenda: opt.value }, selectedOrgId)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border-2 w-full text-left transition-all",
                    config.objetivoVenda === opt.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card hover:border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  <span className="text-base leading-none mt-0.5">{opt.label.slice(0,2)}</span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{opt.label.slice(3)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tom de Venda */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tom de Venda (intensidade)</label>
            <div className="flex gap-2">
              {NIVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => persistConfig({ nivelVenda: opt.value }, selectedOrgId)}
                  className={cn(
                    "flex-1 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-all",
                    config.nivelVenda === opt.value ? opt.color : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nível de Urgência */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nível de Urgência</label>
              <span className={cn(
                "text-sm font-bold px-2.5 py-0.5 rounded-full",
                config.nivelUrgencia <= 2 ? "bg-blue-950/40 text-blue-400" :
                config.nivelUrgencia <= 3 ? "bg-emerald-950/40 text-emerald-400" :
                "bg-orange-950/40 text-orange-400"
              )}>
                {["", "Mínima", "Suave", "Moderada", "Alta", "Máxima"][config.nivelUrgencia]}
              </span>
            </div>
            <Slider
              min={1} max={5} step={1}
              value={[config.nivelUrgencia]}
              onValueChange={([v]) => setConfig((c) => ({ ...c, nivelUrgencia: v }))}
              onValueCommit={([v]) => persistConfig({ nivelUrgencia: v }, selectedOrgId)}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
              <span>Deixar fluir</span>
              <span>Fechar agora</span>
            </div>
          </div>
        </div>
      );

      // ── Módulo 3: Objeções ──────────────────────────────────────────────
      case "objecoes": return (
        <div className="space-y-5">
          <ModuleHeader icon={AlertTriangle} title="Matriz de Objeções" desc="Configure respostas automáticas para objeções do cliente" />

          <div className="space-y-2">
            {config.matrizObjecoes.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">Nenhuma objeção configurada</p>
                <p className="text-xs mt-1">A detecção de preço caro está sempre ativa por padrão.</p>
              </div>
            )}

            {config.matrizObjecoes.map((obj, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={obj.palavraChave}
                    onChange={(e) => {
                      const next = [...config.matrizObjecoes];
                      next[i] = { ...next[i], palavraChave: e.target.value };
                      setConfig((c) => ({ ...c, matrizObjecoes: next }));
                    }}
                    onBlur={() => persistConfig({ matrizObjecoes: config.matrizObjecoes }, selectedOrgId)}
                    placeholder="Palavra-chave (ex: caro, prazo, concorrente)"
                    className="flex-1 text-xs h-8 bg-muted border-transparent"
                  />
                  <button
                    onClick={() => {
                      const next = config.matrizObjecoes.filter((_, idx) => idx !== i);
                      persistConfig({ matrizObjecoes: next }, selectedOrgId);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  value={obj.estrategia}
                  onChange={(e) => {
                    const next = [...config.matrizObjecoes];
                    next[i] = { ...next[i], estrategia: e.target.value };
                    setConfig((c) => ({ ...c, matrizObjecoes: next }));
                  }}
                  onBlur={() => persistConfig({ matrizObjecoes: config.matrizObjecoes }, selectedOrgId)}
                  placeholder="Estratégia de resposta (ex: Reforce o risco zero — paga só na entrega)"
                  className="text-xs h-8 bg-muted border-transparent"
                />
                <Input
                  value={obj.exemplo}
                  onChange={(e) => {
                    const next = [...config.matrizObjecoes];
                    next[i] = { ...next[i], exemplo: e.target.value };
                    setConfig((c) => ({ ...c, matrizObjecoes: next }));
                  }}
                  onBlur={() => persistConfig({ matrizObjecoes: config.matrizObjecoes }, selectedOrgId)}
                  placeholder="Exemplo de resposta ideal (opcional)"
                  className="text-xs h-8 bg-muted border-transparent"
                />
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 border-dashed"
              onClick={() => {
                const next = [...config.matrizObjecoes, { palavraChave: "", estrategia: "", exemplo: "" }];
                setConfig((c) => ({ ...c, matrizObjecoes: next }));
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar objeção
            </Button>
          </div>

          <div className="p-3 rounded-xl bg-muted/50 border border-border text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">💡 Objeção de preço padrão</p>
            <p>A IA detecta automaticamente "caro", "sem dinheiro", "preço alto" e aplica até 5 estratégias de quebra em sequência (parcela → risco zero → comparação → urgência → kit). Essa objeção está sempre ativa.</p>
          </div>
        </div>
      );

      // ── Módulo 4: Restrições ────────────────────────────────────────────
      case "restricoes": return (
        <div className="space-y-5">
          <ModuleHeader icon={Shield} title="Mural de Restrições" desc="O que a IA NUNCA deve fazer, falar ou prometer" />

          <div className="space-y-2">
            {config.restricoes.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                <Shield className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">Nenhuma restrição configurada</p>
                <p className="text-xs mt-1">Adicione regras absolutas que a IA deve seguir.</p>
              </div>
            )}

            {config.restricoes.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-destructive/20 text-destructive flex items-center justify-center flex-shrink-0 text-[10px] font-bold">
                  ✕
                </div>
                <Input
                  value={r}
                  onChange={(e) => {
                    const next = [...config.restricoes];
                    next[i] = e.target.value;
                    setConfig((c) => ({ ...c, restricoes: next }));
                  }}
                  onBlur={() => persistConfig({ restricoes: config.restricoes }, selectedOrgId)}
                  placeholder="ex: Nunca prometa entrega no mesmo dia sem confirmar estoque"
                  className="flex-1 text-sm bg-card border-border h-9"
                />
                <button
                  onClick={() => {
                    const next = config.restricoes.filter((_, idx) => idx !== i);
                    persistConfig({ restricoes: next }, selectedOrgId);
                  }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            <Button
              variant="outline" size="sm" className="w-full gap-2 border-dashed"
              onClick={() => setConfig((c) => ({ ...c, restricoes: [...c.restricoes, ""] }))}
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar restrição
            </Button>
          </div>

          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-300/80">
            <p className="font-medium text-amber-300 mb-1">⚠️ Como funciona</p>
            <p>Cada restrição é injetada no prompt como instrução imperativa. Seja específico: "Nunca mencione o concorrente X" é melhor que "Não fale de concorrentes".</p>
          </div>
        </div>
      );

      // ── Módulo 5: Follow-up ─────────────────────────────────────────────
      case "followup": return (
        <div className="space-y-6">
          <ModuleHeader icon={Timer} title="Gestor de Follow-up" desc="Configure quando e quantas vezes a IA recontata leads silenciosos" />

          {/* Tentativas máximas */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Máximo de Tentativas</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => persistConfig({ followUpMaxTentativas: n }, selectedOrgId)}
                  className={cn(
                    "flex-1 py-2 rounded-xl border-2 text-sm font-bold transition-all",
                    config.followUpMaxTentativas === n
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">A IA para de enviar follow-ups após este número de tentativas sem resposta.</p>
          </div>

          {/* Intervalos */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Intervalos por Tentativa</label>
            {config.followUpIntervalos.slice(0, config.followUpMaxTentativas).map((hrs, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium">Tentativa {i + 1}</p>
                  <p className="text-[10px] text-muted-foreground">após o silêncio do cliente</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={hrs}
                    onChange={(e) => {
                      const next = [...config.followUpIntervalos];
                      next[i] = parseInt(e.target.value) || 1;
                      setConfig((c) => ({ ...c, followUpIntervalos: next }));
                    }}
                    onBlur={() => persistConfig({ followUpIntervalos: config.followUpIntervalos }, selectedOrgId)}
                    className="w-16 text-center text-sm font-bold bg-muted border border-border rounded-lg py-1.5 text-foreground"
                  />
                  <span className="text-xs text-muted-foreground">{hrs === 1 ? "hora" : hrs < 24 ? "horas" : `${(hrs/24).toFixed(0)}d`}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-muted/50 border border-border text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">💡 Como funciona</p>
            <p>Quando o cliente para de responder, a IA dispara follow-ups nos intervalos configurados. Qualquer resposta do cliente cancela todos os follow-ups pendentes.</p>
          </div>
        </div>
      );

      // ── Módulo 6: Script ────────────────────────────────────────────────
      case "script": return (
        <div className="flex flex-col h-full space-y-3">
          <div className="flex items-center justify-between flex-shrink-0">
            <ModuleHeader icon={Brain} title="Script do Agente" desc="Roteiro base, argumentos e persona" />
            <div className="flex items-center gap-2 ml-4">
              {scriptModified && <Badge variant="outline" className="text-xs text-amber-500 border-amber-700/50">modificado</Badge>}
              {saveSuccess  && <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-700/50"><CheckCircle2 className="w-3 h-3 mr-1" />salvo!</Badge>}
              <Button
                variant="ghost" size="sm" onClick={() => setShowVersions((v) => !v)}
                className="text-xs h-7 gap-1 text-muted-foreground"
              >
                <History className="w-3.5 h-3.5" />
                {showVersions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
              <Button
                size="sm" onClick={handleSaveScript}
                disabled={!scriptModified || savingScript || !selectedAgentId}
                className="h-7 text-xs gap-1"
              >
                {savingScript ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            </div>
          </div>

          {showVersions && (
            <div className="border border-border rounded-xl bg-muted/30 max-h-44 overflow-y-auto flex-shrink-0">
              {versions.length === 0
                ? <p className="text-xs text-muted-foreground p-3">Nenhuma versão salva ainda.</p>
                : <div className="divide-y divide-border">
                    {versions.map((v, i) => (
                      <div key={v.id} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40 group">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{i === 0 ? "Versão anterior" : `Versão ${versions.length - i}`}
                            {v.savedBy && <span className="text-muted-foreground font-normal"> · {v.savedBy}</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)}</p>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{v.content.substring(0, 80)}…</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleRestoreVersion(v.id)}
                          className="h-6 text-[11px] opacity-0 group-hover:opacity-100 gap-1">
                          <RotateCcw className="w-3 h-3" />Restaurar
                        </Button>
                      </div>
                    ))}
                  </div>
              }
            </div>
          )}

          <Textarea
            value={scriptContent}
            onChange={(e) => {
              setScriptContent(e.target.value);
              setScriptModified(e.target.value !== (selectedAgent?.systemPrompt ?? ""));
            }}
            placeholder="O roteiro base do agente — persona, argumentos, casos de uso. O PromptCompiler vai compilar isso junto com as configurações dos outros módulos."
            className="flex-1 resize-none font-mono text-xs leading-relaxed bg-card border-border min-h-[300px]"
          />
          <div className="flex justify-between items-center text-[10px] text-muted-foreground flex-shrink-0">
            <span>{scriptContent.length} chars · {scriptContent.split("\n").length} linhas</span>
            {scriptModified && (
              <button onClick={() => { setScriptContent(selectedAgent?.systemPrompt ?? ""); setScriptModified(false); }}
                className="text-muted-foreground hover:text-destructive transition-colors">
                descartar mudanças
              </button>
            )}
          </div>
        </div>
      );

      default: return null;
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Settings2 className="w-4 h-4 text-primary flex-shrink-0" />
          <h1 className="font-semibold text-base truncate">Centro de Comando</h1>
          {(configSaving || configSaved) && (
            <div className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors",
              configSaved ? "text-emerald-400 bg-emerald-950/40" : "text-muted-foreground"
            )}>
              {configSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {configSaved ? "salvo" : "salvando..."}
            </div>
          )}
        </div>

        {allAgents.length > 1 && (
          <select
            className="text-sm border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
            value={selectedAgentId ?? ""}
            onChange={(e) => {
              const entry = allAgents.find((a) => a.agent.id === e.target.value);
              if (entry) handleSelectAgent(entry);
            }}
          >
            {allAgents.map(({ agent, account, org }) => (
              <option key={agent.id} value={agent.id}>{org.name} — {account.accountName}</option>
            ))}
          </select>
        )}

        {selectedAgent && (
          <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-800/50 bg-emerald-950/40 hidden sm:flex">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
            {selectedAgent.displayName}
          </Badge>
        )}
      </div>

      {/* ── Mobile tab bar ── */}
      <div className="flex md:hidden border-b border-border bg-card flex-shrink-0">
        {(["modules", "chat", "test"] as const).map((v) => (
          <button key={v} onClick={() => setMobileView(v)}
            className={cn("flex-1 py-2.5 text-xs font-medium transition-colors",
              mobileView === v ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
            )}>
            {v === "modules" ? "⚙️ Módulos" : v === "chat" ? "🤖 Chat" : "⚡ Teste"}
          </button>
        ))}
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ══ LEFT: Module Sidebar + Panel ═══════════════════════════════════ */}
        <div className={cn("flex flex-col border-r border-border", "w-full md:w-[50%] lg:w-[55%]", mobileView !== "modules" && "hidden md:flex")}>
          <div className="flex flex-1 min-h-0">

            {/* Module navigation */}
            <nav className="w-[56px] flex-shrink-0 border-r border-border bg-card flex flex-col gap-1 py-3 px-1.5">
              {MODULE_META.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => setActiveModule(m.id)}
                    title={m.label}
                    className={cn(
                      "w-full flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all",
                      activeModule === m.id
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[9px] font-medium leading-none">{m.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Active module panel */}
            <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
              <div className="max-w-lg">
                {renderModulePanel()}
              </div>
            </div>
          </div>
        </div>

        {/* ══ RIGHT: Chat + Test ═══════════════════════════════════════════ */}
        <div className={cn("flex flex-col flex-1 min-w-0", mobileView === "chat" || mobileView === "test" ? "flex" : "hidden md:flex")}>

          {/* Chat Configurador */}
          <div className={cn("flex flex-col border-b border-border", mobileView === "test" ? "hidden md:flex md:h-[55%]" : "flex-1 md:h-[55%]")}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
              <Bot className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium">Chat com o Configurador</span>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn("flex gap-2 max-w-full", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                    <div className={cn("flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs",
                      msg.role === "user" ? "bg-primary" : "bg-emerald-600")}>
                      {msg.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                    </div>
                    <div className={cn("flex flex-col gap-0.5 max-w-[80%]", msg.role === "user" ? "items-end" : "items-start")}>
                      <div className={cn("px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
                        msg.role === "user"
                          ? "bg-primary text-white rounded-tr-sm"
                          : "bg-muted text-foreground rounded-tl-sm"
                      )}>{msg.content}</div>
                      <span className="text-[10px] text-muted-foreground px-1">
                        {msg.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>
            </ScrollArea>

            <div className="p-3 border-t border-border bg-card flex-shrink-0">
              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="ex: quero que o agente pare de pedir localização..."
                  className="min-h-[40px] max-h-[100px] resize-none text-sm bg-muted border-transparent"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                />
                <Button size="icon" onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()} className="h-10 w-10 flex-shrink-0">
                  {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Quick Test */}
          <div className={cn("flex flex-col bg-background flex-shrink-0", mobileView === "test" ? "flex-1" : "md:flex-1")}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium">Teste Rápido</span>
              {scriptModified && <Badge variant="outline" className="text-xs text-amber-500 border-amber-700/50 ml-1">script local</Badge>}
            </div>

            <div className="p-3 flex gap-2 flex-shrink-0">
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Simule uma mensagem do cliente, ex: oi quero saber sobre a 48v"
                className="min-h-[40px] max-h-[80px] resize-none text-sm flex-1 bg-muted border-transparent"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTest(); } }}
              />
              <Button onClick={handleTest} disabled={testLoading || !testInput.trim() || !selectedAgentId}
                className="h-10 gap-1.5 flex-shrink-0 bg-violet-600 hover:bg-violet-700">
                {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                <span className="hidden sm:inline">Testar</span>
              </Button>
            </div>

            {testResult && (
              <div className="mx-3 mb-3 rounded-xl border border-border bg-card overflow-hidden flex-shrink-0">
                <div className="p-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Como o agente responderia:</p>
                  {testResult.balloons.map((balloon, i) => (
                    <div key={i} className="flex justify-end">
                      <div className="msg-bubble-sent text-sm max-w-[85%]">{balloon}</div>
                    </div>
                  ))}
                </div>
                {testResult.ruleActivated && (
                  <div className="px-3 py-2 border-t border-border">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-violet-400">Regra ativada:</span> {testResult.ruleActivated}
                    </p>
                  </div>
                )}
                <div className="flex gap-2 p-2 border-t border-border">
                  <Button size="sm" onClick={handleSaveScript} className="flex-1 h-8 text-xs gap-1 bg-emerald-700 hover:bg-emerald-600">
                    <CheckCircle2 className="w-3.5 h-3.5" />Salvar script
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTestResult(null)} className="h-8 text-xs gap-1">
                    <XCircle className="w-3.5 h-3.5" />Ajustar
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

// ── Shared sub-components ─────────────────────────────────────────────────────

function ModuleHeader({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 mb-1">
      <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
