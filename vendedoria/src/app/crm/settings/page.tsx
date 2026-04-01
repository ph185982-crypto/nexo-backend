"use client";

import React, { useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Settings, Phone, Bot, Plus, Save, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, RefreshCw, Wifi, WifiOff,
  Building2, Key, MessageSquare, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ─── GraphQL ──────────────────────────────────────────────────────────────

const GET_SETTINGS = gql`
  query GetSettings {
    whatsappBusinessOrganizations {
      id name documentId documentType status
      accounts {
        id accountName displayPhoneNumber businessPhoneNumberId wabaId status
        agent {
          id displayName kind status systemPrompt aiProvider aiModel escalationThreshold sandboxMode
        }
      }
    }
  }
`;

const GET_KANBAN_COLUMNS = gql`
  query GetKanbanColumnsSettings($organizationId: String!) {
    getKanbanBoard(organizationId: $organizationId, leadsPerColumn: 0) {
      columns { id name color order type }
    }
  }
`;

const CREATE_ORG = gql`
  mutation CreateOrg($input: CreateOrganizationInput!) {
    createOrganization(input: $input) { id name status }
  }
`;

const UPDATE_ORG = gql`
  mutation UpdateOrg($id: String!, $input: UpdateOrganizationInput!) {
    updateOrganization(id: $id, input: $input) { id name documentId documentType status }
  }
`;

const CREATE_ACCOUNT = gql`
  mutation CreateAccount($input: CreateWhatsappAccountInput!) {
    createWhatsappAccount(input: $input) {
      id accountName displayPhoneNumber status
      agent { id displayName status }
    }
  }
`;

const DELETE_ACCOUNT = gql`
  mutation DeleteAccount($id: String!) {
    deleteWhatsappAccount(id: $id)
  }
`;

const TEST_WHATSAPP = gql`
  mutation TestWhatsapp($accountId: String!) {
    testWhatsappConnection(accountId: $accountId) {
      success message phoneNumber
    }
  }
`;

const UPDATE_AGENT = gql`
  mutation UpdateAgent($id: String!, $input: UpdateAgentInput!) {
    updateAgent(id: $id, input: $input) {
      id displayName status systemPrompt aiProvider aiModel escalationThreshold sandboxMode
    }
  }
`;

const UPDATE_KANBAN_COLUMN = gql`
  mutation UpdateKanbanColumn($id: String!, $input: UpdateKanbanColumnInput!) {
    updateKanbanColumn(id: $id, input: $input) { id name color }
  }
`;

const CHANGE_PASSWORD = gql`
  mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
    changePassword(currentPassword: $currentPassword, newPassword: $newPassword)
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────

const AI_MODELS: Record<string, string[]> = {
  OPENAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  ANTHROPIC: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
};

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente virtual de vendas para WhatsApp.
Seu objetivo é:
1. Cumprimentar o cliente de forma amigável e profissional
2. Entender a necessidade e qualificar o lead
3. Apresentar os serviços/produtos disponíveis
4. Agendar uma reunião ou escalar para atendimento humano quando necessário

Regras:
- Responda sempre em português do Brasil
- Seja conciso e direto (máximo 3 parágrafos por mensagem)
- Se o cliente demonstrar interesse alto ou urgência, use [ESCALAR] no início da resposta
- Se quiser agendar, use [AGENDAR] no início da resposta
- Tom profissional mas acolhedor`;

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentType {
  id: string;
  displayName: string;
  kind: string;
  status: string;
  systemPrompt?: string;
  aiProvider?: string;
  sandboxMode?: boolean;
  aiModel?: string;
  escalationThreshold?: number;
}

interface AccountType {
  id: string;
  accountName: string;
  displayPhoneNumber: string;
  businessPhoneNumberId: string;
  wabaId?: string;
  status: string;
  agent?: AgentType;
}

interface OrgType {
  id: string;
  name: string;
  documentId: string;
  documentType: string;
  status: string;
  accounts: AccountType[];
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; icon: React.ElementType; className: string }> = {
    CONNECTED: { label: "Conectado", icon: Wifi, className: "bg-green-100 text-green-700" },
    DISCONNECTED: { label: "Desconectado", icon: WifiOff, className: "bg-red-100 text-red-700" },
    ERROR: { label: "Erro", icon: XCircle, className: "bg-red-100 text-red-700" },
    BANNED: { label: "Banido", icon: XCircle, className: "bg-red-100 text-red-700" },
    ACTIVE: { label: "Ativo", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
    INACTIVE: { label: "Inativo", icon: XCircle, className: "bg-gray-100 text-gray-600" },
  };
  const cfg = config[status] ?? { label: status, icon: Phone, className: "bg-gray-100 text-gray-600" };
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Aba: Organização ──────────────────────────────────────────────────────

function OrganizationTab({ orgs, refetch }: { orgs: OrgType[]; refetch: () => void }) {
  const org = orgs[0];
  const [form, setForm] = useState({
    name: org?.name ?? "",
    documentId: org?.documentId ?? "",
    documentType: org?.documentType ?? "CNPJ",
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [createOrg, { loading: creating }] = useMutation(CREATE_ORG);
  const [updateOrg, { loading: updating }] = useMutation(UPDATE_ORG);
  const saving = creating || updating;

  const handleSave = async () => {
    try {
      if (org) {
        await updateOrg({ variables: { id: org.id, input: { name: form.name, documentId: form.documentId } } });
      } else {
        await createOrg({ variables: { input: { name: form.name, documentId: form.documentId, documentType: form.documentType } } });
      }
      refetch();
      setFeedback({ ok: true, msg: "Salvo com sucesso!" });
    } catch (err) {
      setFeedback({ ok: false, msg: (err as Error).message });
    } finally {
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Dados da Organização
          </CardTitle>
          <CardDescription>Informações da sua empresa ou negócio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome do Negócio *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Clínica Saúde Total"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo de Documento</Label>
              <Select value={form.documentType} onValueChange={(v) => setForm({ ...form, documentType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CNPJ">CNPJ</SelectItem>
                  <SelectItem value="CPF">CPF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.documentType}</Label>
              <Input
                value={form.documentId}
                onChange={(e) => setForm({ ...form, documentId: e.target.value })}
                placeholder={form.documentType === "CNPJ" ? "00.000.000/0001-00" : "000.000.000-00"}
              />
            </div>
          </div>
          {feedback && (
            <p className={cn("text-sm", feedback.ok ? "text-green-600" : "text-red-600")}>{feedback.msg}</p>
          )}
          <Button onClick={handleSave} disabled={saving || !form.name} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {org ? "Salvar Alterações" : "Criar Organização"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Aba: WhatsApp ─────────────────────────────────────────────────────────

function WhatsappTab({ orgs, refetch }: { orgs: OrgType[]; refetch: () => void }) {
  const org = orgs[0];
  const accounts = org?.accounts ?? [];
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [addingNew, setAddingNew] = useState(false);
  const [newAccount, setNewAccount] = useState({
    accountName: "", displayPhoneNumber: "", businessPhoneNumberId: "", wabaId: "", accessToken: "",
  });
  const [error, setError] = useState("");

  const [createAccount, { loading: creating }] = useMutation(CREATE_ACCOUNT);
  const [deleteAccount] = useMutation(DELETE_ACCOUNT);
  const [testConnection] = useMutation(TEST_WHATSAPP);

  const handleTest = async (accountId: string) => {
    setTesting(accountId);
    try {
      const { data } = await testConnection({ variables: { accountId } });
      const result = data?.testWhatsappConnection;
      setTestResult((prev) => ({
        ...prev,
        [accountId]: { ok: result.success, msg: result.message + (result.phoneNumber ? ` (${result.phoneNumber})` : "") },
      }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [accountId]: { ok: false, msg: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  const handleAddAccount = async () => {
    if (!newAccount.accountName || !newAccount.businessPhoneNumberId || !newAccount.accessToken) {
      setError("Preencha Nome, Phone Number ID e Access Token");
      return;
    }
    setError("");
    try {
      await createAccount({
        variables: {
          input: {
            ...newAccount,
            organizationId: org?.id ?? "",
          },
        },
      });
      setAddingNew(false);
      setNewAccount({ accountName: "", displayPhoneNumber: "", businessPhoneNumberId: "", wabaId: "", accessToken: "" });
      refetch();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover esta conta WhatsApp?")) return;
    await deleteAccount({ variables: { id } });
    refetch();
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Como obter as credenciais da Meta</h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Acesse <strong>developers.facebook.com</strong> → Seu App → WhatsApp → API Setup</li>
            <li>Copie o <strong>Phone Number ID</strong> e o <strong>WhatsApp Business Account ID (WABA ID)</strong></li>
            <li>Gere um <strong>Access Token</strong> permanente nas configurações do app</li>
            <li>Configure o webhook: <code className="bg-blue-100 px-1 rounded text-xs">/api/webhooks/whatsapp</code></li>
          </ol>
        </CardContent>
      </Card>

      {accounts.map((account) => (
        <Card key={account.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                  <Phone className="w-5 h-5 text-green-700" />
                </div>
                <div>
                  <CardTitle className="text-base">{account.accountName}</CardTitle>
                  <p className="text-sm text-muted-foreground">{account.displayPhoneNumber}</p>
                </div>
              </div>
              <StatusBadge status={account.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Phone Number ID</p>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{account.businessPhoneNumberId}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">WABA ID</p>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{account.wabaId ?? "—"}</code>
              </div>
            </div>

            {testResult[account.id] && (
              <div className={cn(
                "flex items-center gap-2 p-2 rounded-md text-sm",
                testResult[account.id].ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              )}>
                {testResult[account.id].ok
                  ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  : <XCircle className="w-4 h-4 flex-shrink-0" />}
                {testResult[account.id].msg}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTest(account.id)}
                disabled={testing === account.id}
                className="gap-1.5"
              >
                {testing === account.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Testar Conexão
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(account.id)}
                className="gap-1.5 text-red-600 hover:text-red-700"
              >
                Remover
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {addingNew ? (
        <Card className="border-dashed border-2 border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Nova Conta WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Nome da Conta *</Label>
                <Input
                  placeholder="Ex: WhatsApp Vendas Principal"
                  value={newAccount.accountName}
                  onChange={(e) => setNewAccount({ ...newAccount, accountName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Número de Exibição</Label>
                <Input
                  placeholder="+55 11 99999-9999"
                  value={newAccount.displayPhoneNumber}
                  onChange={(e) => setNewAccount({ ...newAccount, displayPhoneNumber: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number ID *</Label>
                <Input
                  placeholder="Ex: 123456789012345"
                  value={newAccount.businessPhoneNumberId}
                  onChange={(e) => setNewAccount({ ...newAccount, businessPhoneNumberId: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input
                  placeholder="Ex: 987654321098765"
                  value={newAccount.wabaId}
                  onChange={(e) => setNewAccount({ ...newAccount, wabaId: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Access Token *</Label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    placeholder="EAAxxxxx..."
                    value={newAccount.accessToken}
                    onChange={(e) => setNewAccount({ ...newAccount, accessToken: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Token permanente das configurações do app Meta</p>
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleAddAccount}
                disabled={creating || !newAccount.accountName || !newAccount.businessPhoneNumberId}
                className="gap-2"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Conta
              </Button>
              <Button variant="outline" onClick={() => { setAddingNew(false); setError(""); }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          className="w-full gap-2 border-dashed"
          onClick={() => setAddingNew(true)}
          disabled={!org}
        >
          <Plus className="w-4 h-4" />
          {!org ? "Crie uma organização primeiro" : "Conectar Nova Conta WhatsApp"}
        </Button>
      )}
    </div>
  );
}

// ─── Aba: Agente IA ────────────────────────────────────────────────────────

function AgentTab({ orgs }: { orgs: OrgType[] }) {
  const accounts = orgs[0]?.accounts ?? [];
  const agent = accounts[0]?.agent;

  const [form, setForm] = useState({
    systemPrompt: agent?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    aiProvider: agent?.aiProvider ?? "ANTHROPIC",
    aiModel: agent?.aiModel ?? "claude-sonnet-4-6",
    escalationThreshold: agent?.escalationThreshold ?? 3,
    status: agent?.status ?? "ACTIVE",
    sandboxMode: agent?.sandboxMode ?? false,
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [updateAgent, { loading: saving }] = useMutation(UPDATE_AGENT);

  const handleSave = async () => {
    if (!agent) return;
    try {
      await updateAgent({
        variables: {
          id: agent.id,
          input: {
            status: form.status,
            aiProvider: form.aiProvider,
            aiModel: form.aiModel,
            systemPrompt: form.systemPrompt,
            escalationThreshold: form.escalationThreshold,
            sandboxMode: form.sandboxMode,
          },
        },
      });
      setFeedback({ ok: true, msg: "Configurações salvas!" });
    } catch (err) {
      setFeedback({ ok: false, msg: (err as Error).message });
    } finally {
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const models = AI_MODELS[form.aiProvider] ?? [];

  if (!agent) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Conecte uma conta WhatsApp primeiro — o agente IA será criado automaticamente.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              Status do Agente IA
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {form.status === "ACTIVE" ? "Ativo — respondendo mensagens" : "Inativo — mensagens não respondidas"}
              </span>
              <Switch
                checked={form.status === "ACTIVE"}
                onCheckedChange={(v) => setForm({ ...form, status: v ? "ACTIVE" : "INACTIVE" })}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className={cn(form.sandboxMode && "border-amber-400 bg-amber-50/30")}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500" />
                Modo Sandbox (Teste)
              </CardTitle>
              <CardDescription className="mt-1">
                Quando ativo, o agente só responde ao número de teste configurado em{" "}
                <code className="bg-muted px-1 rounded text-xs">SANDBOX_TEST_NUMBER</code>.
                Use durante testes para não responder clientes reais.
              </CardDescription>
            </div>
            <Switch
              checked={form.sandboxMode}
              onCheckedChange={(v) => setForm({ ...form, sandboxMode: v })}
            />
          </div>
        </CardHeader>
        {form.sandboxMode && (
          <CardContent className="pt-0">
            <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              Modo sandbox ativo — apenas o número em{" "}
              <code className="bg-amber-200 px-1 rounded">SANDBOX_TEST_NUMBER</code> receberá respostas.
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Modelo de IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Provedor</Label>
              <Select
                value={form.aiProvider}
                onValueChange={(v) => setForm({ ...form, aiProvider: v, aiModel: AI_MODELS[v]?.[0] ?? "" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANTHROPIC">Anthropic (Claude)</SelectItem>
                  <SelectItem value="OPENAI">OpenAI (GPT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <Select value={form.aiModel} onValueChange={(v) => setForm({ ...form, aiModel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label>Limite para escalar para humano</Label>
              <span className="text-sm font-semibold text-primary">{form.escalationThreshold} msgs</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Após este número de mensagens sem resolver, o agente escalará o lead para você
            </p>
            <input
              type="range"
              min={1}
              max={10}
              value={form.escalationThreshold}
              onChange={(e) => setForm({ ...form, escalationThreshold: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 (agressivo)</span>
              <span>10 (permissivo)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Instruções do Agente (System Prompt)
          </CardTitle>
          <CardDescription>
            Descreva como o agente deve se comportar, o que vende, como falar com clientes, etc.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            rows={18}
            className="font-mono text-sm resize-y min-h-[200px]"
            placeholder="Você é um assistente de vendas da [Empresa]. Seu objetivo é..."
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{form.systemPrompt.length} caracteres</span>
            <span>{form.systemPrompt.split("\n").length} linhas</span>
          </div>
          <div className="rounded-md bg-muted/60 border border-border px-3 py-2.5 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Flags disponíveis</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
              {[
                ["[ESCALAR]", "Passa para atendimento humano"],
                ["[PASSAGEM]{...JSON}", "Envia pedido para o dono"],
                ["[OPT_OUT]", "Bloqueia lead (pediu para não contatar)"],
                ["[FOTO_SLUG]", "Envia foto do produto no WhatsApp"],
                ["[VIDEO_SLUG]", "Envia vídeo do produto no WhatsApp"],
              ].map(([flag, desc]) => (
                <div key={flag} className="flex items-start gap-1.5">
                  <code className="bg-background border border-border px-1 rounded text-[10px] flex-shrink-0">{flag}</code>
                  <span className="opacity-70">{desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground flex-1">
              Os produtos do catálogo são injetados automaticamente — não precisa listá-los aqui.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, systemPrompt: DEFAULT_SYSTEM_PROMPT })}
            >
              Restaurar Padrão
            </Button>
          </div>
        </CardContent>
      </Card>

      {feedback && (
        <p className={cn("text-sm", feedback.ok ? "text-green-600" : "text-red-600")}>{feedback.msg}</p>
      )}

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar Configurações
      </Button>
    </div>
  );
}

// ─── Aba: Kanban ───────────────────────────────────────────────────────────

function KanbanTab({ orgs }: { orgs: OrgType[] }) {
  const orgId = orgs[0]?.id ?? "";
  const { data, refetch } = useQuery(GET_KANBAN_COLUMNS, {
    variables: { organizationId: orgId },
    skip: !orgId,
  });
  const columns: Array<{ id: string; name: string; color: string; order: number; type: string }> =
    data?.getKanbanBoard?.columns ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", color: "" });
  const [updateColumn, { loading: saving }] = useMutation(UPDATE_KANBAN_COLUMN);

  const PRESET_COLORS = [
    "#3b82f6", "#22c55e", "#f97316", "#8b5cf6",
    "#ef4444", "#6b7280", "#ec4899", "#0891b2",
  ];

  const startEdit = (col: { id: string; name: string; color: string }) => {
    setEditingId(col.id);
    setEditForm({ name: col.name, color: col.color });
  };

  const handleSave = async () => {
    if (!editingId) return;
    await updateColumn({ variables: { id: editingId, input: { name: editForm.name, color: editForm.color } } });
    setEditingId(null);
    refetch();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Colunas do Kanban</CardTitle>
          <CardDescription>Personalize os nomes e cores das colunas do seu pipeline de vendas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {columns.map((col) => (
            <div key={col.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
              <div className="w-4 h-8 rounded flex-shrink-0" style={{ backgroundColor: col.color }} />
              {editingId === col.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="h-7 text-sm"
                  />
                  <div className="flex gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditForm({ ...editForm, color: c })}
                        className={cn(
                          "w-5 h-5 rounded-full border-2 transition-transform",
                          editForm.color === c ? "border-foreground scale-125" : "border-transparent"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{col.name}</span>
                  <Badge variant="muted" className="text-xs">{col.type}</Badge>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startEdit(col)}>
                    Editar
                  </Button>
                </>
              )}
            </div>
          ))}
          {columns.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Execute <code className="bg-muted px-1 rounded">npm run db:seed</code> para criar as colunas padrão
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Aba: Segurança ────────────────────────────────────────────────────────

function SecurityTab() {
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [changePassword, { loading: saving }] = useMutation(CHANGE_PASSWORD);

  const handleSave = async () => {
    if (passwords.new !== passwords.confirm) return;
    try {
      await changePassword({ variables: { currentPassword: passwords.current, newPassword: passwords.new } });
      setFeedback({ ok: true, msg: "Senha alterada com sucesso!" });
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err) {
      setFeedback({ ok: false, msg: (err as Error).message });
    } finally {
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            Alterar Senha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          {(["current", "new", "confirm"] as const).map((field) => (
            <div key={field} className="space-y-1.5">
              <Label>
                {field === "current" ? "Senha Atual" : field === "new" ? "Nova Senha" : "Confirmar Nova Senha"}
              </Label>
              <Input
                type="password"
                value={passwords[field]}
                onChange={(e) => setPasswords({ ...passwords, [field]: e.target.value })}
              />
            </div>
          ))}
          {passwords.new && passwords.confirm && passwords.new !== passwords.confirm && (
            <p className="text-sm text-destructive">As senhas não coincidem</p>
          )}
          {feedback && (
            <p className={cn("text-sm", feedback.ok ? "text-green-600" : "text-red-600")}>{feedback.msg}</p>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || !passwords.current || !passwords.new || passwords.new !== passwords.confirm}
            className="gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            Alterar Senha
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chaves de API</CardTitle>
          <CardDescription>Configure as chaves de API no arquivo .env do projeto</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { label: "Anthropic API Key", env: "ANTHROPIC_API_KEY", desc: "Para usar Claude como agente (recomendado)" },
              { label: "OpenAI API Key", env: "OPENAI_API_KEY", desc: "Para usar GPT-4o como agente" },
              { label: "Meta Verify Token", env: "META_WHATSAPP_VERIFY_TOKEN", desc: "Token de verificação do webhook" },
              { label: "Cron Secret", env: "CRON_SECRET", desc: "Protege o endpoint do worker de campanhas" },
            ].map((item) => (
              <div key={item.env} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <code className="text-xs bg-muted px-2 py-1 rounded">{item.env}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data, loading, refetch } = useQuery(GET_SETTINGS, {
    fetchPolicy: "cache-and-network",
  });

  const orgs: OrgType[] = data?.whatsappBusinessOrganizations ?? [];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Configurações</h1>
          <p className="text-sm text-muted-foreground">Gerencie sua organização, WhatsApp e agente IA</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs defaultValue="whatsapp">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="whatsapp" className="gap-1.5 text-xs">
              <Phone className="w-3.5 h-3.5" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5 text-xs">
              <Bot className="w-3.5 h-3.5" />
              Agente IA
            </TabsTrigger>
            <TabsTrigger value="kanban" className="gap-1.5 text-xs">
              <Settings className="w-3.5 h-3.5" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="organization" className="gap-1.5 text-xs">
              <Building2 className="w-3.5 h-3.5" />
              Organização
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5 text-xs">
              <Key className="w-3.5 h-3.5" />
              Segurança
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="whatsapp">
              <WhatsappTab orgs={orgs} refetch={refetch} />
            </TabsContent>
            <TabsContent value="agent">
              <AgentTab orgs={orgs} />
            </TabsContent>
            <TabsContent value="kanban">
              <KanbanTab orgs={orgs} />
            </TabsContent>
            <TabsContent value="organization">
              <OrganizationTab orgs={orgs} refetch={refetch} />
            </TabsContent>
            <TabsContent value="security">
              <SecurityTab />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
