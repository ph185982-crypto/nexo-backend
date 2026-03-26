"use client";

import React, { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Upload, Smartphone, ArrowLeft, ArrowRight, CheckCircle2, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const GET_ACCOUNTS = gql`
  query GetAccountsForCampaign($organizationId: String!) {
    whatsappAccounts(organizationId: $organizationId) {
      id accountName displayPhoneNumber status
    }
  }
`;

const CREATE_CAMPAIGN = gql`
  mutation CreateCampaign($input: CreateCampaignInput!) {
    createCampaign(input: $input) {
      id name status
    }
  }
`;

const STEPS = [
  "Configuração Inicial",
  "Público Alvo",
  "Mensagem",
  "Configurações de Envio",
];

interface Recipient {
  phoneNumber: string;
  name?: string;
  [key: string]: string | undefined;
}

export default function NewCampaignPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  // Form state
  const [config, setConfig] = useState({
    name: "",
    senderId: "",
    objective: "OUTBOUND",
    mode: "DEFAULT",
    triggerType: "SCHEDULED",
    scheduledAt: "",
    templateMessage: "",
    phoneColumn: "telefone",
    identificationColumn: "nome",
    minDelaySeconds: 15,
    maxDelaySeconds: 45,
    maxMessagesPerMinute: 5,
    dailyStartTime: "08:00",
    dailyEndTime: "20:00",
    maxConsecutiveDays: 7,
    skipExistingConversation: true,
  });

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  const { data: accountsData } = useQuery(GET_ACCOUNTS, {
    variables: { organizationId: orgId },
  });
  const accounts = accountsData?.whatsappAccounts ?? [];

  const [createCampaign, { loading: creating }] = useMutation(CREATE_CAMPAIGN, {
    onCompleted: (data) => {
      router.push(`/crm/campaign/view/${data.createCampaign.id}`);
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      if (lines.length === 0) return;

      const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
      setCsvHeaders(headers);

      const parsedRecipients: Recipient[] = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
        const obj: Recipient = { phoneNumber: "" };
        headers.forEach((h, i) => { obj[h] = values[i] ?? ""; });
        obj.phoneNumber = obj[config.phoneColumn] ?? obj[headers[0]] ?? "";
        obj.name = obj[config.identificationColumn] ?? obj[headers[1]] ?? "";
        return obj;
      }).filter((r) => r.phoneNumber);

      setRecipients(parsedRecipients);
    };
    reader.readAsText(file);
  };

  const interpolateMessage = (msg: string, recipient: Recipient) => {
    return msg.replace(/\{\{(\w+)\}\}/g, (_, key) => recipient[key] ?? key);
  };

  const validateStep = () => {
    const errs: string[] = [];
    if (step === 0) {
      if (!config.name) errs.push("Nome da campanha é obrigatório");
      if (!config.senderId) errs.push("Selecione um número de envio");
    }
    if (step === 1) {
      if (recipients.length === 0) errs.push("Faça upload de uma lista de destinatários");
    }
    if (step === 2) {
      if (!config.templateMessage) errs.push("Mensagem é obrigatória");
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const handleNext = () => {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleCreate = async () => {
    if (!validateStep()) return;
    await createCampaign({
      variables: {
        input: {
          ...config,
          organizationId: orgId,
          scheduledAt: config.scheduledAt || undefined,
          recipients: recipients.map((r) => ({
            phoneNumber: r.phoneNumber,
            name: r.name,
            metadata: r,
          })),
        },
      },
    });
  };

  const previewMessage = recipients[0]
    ? interpolateMessage(config.templateMessage, recipients[0])
    : config.templateMessage || "Sua mensagem aparecerá aqui...";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Nova Campanha</h1>
          <p className="text-sm text-muted-foreground">Crie uma campanha de mensagens em massa</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  i < step ? "bg-green-500 text-white" :
                  i === step ? "bg-primary text-white" :
                  "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-sm hidden sm:block",
                  i === step ? "font-semibold text-primary" : "text-muted-foreground"
                )}
              >
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("flex-1 h-0.5", i < step ? "bg-green-500" : "bg-muted")} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          {/* Step 0: Config */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da Campanha *</Label>
                <Input
                  placeholder="Ex: Campanha Black Friday 2025"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Canal de Envio (Número) *</Label>
                <Select value={config.senderId} onValueChange={(v) => setConfig({ ...config, senderId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar número WhatsApp" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: { id: string; accountName: string; displayPhoneNumber: string }) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountName} ({a.displayPhoneNumber})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Objetivo</Label>
                  <Select value={config.objective} onValueChange={(v) => setConfig({ ...config, objective: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OUTBOUND">Prospecção</SelectItem>
                      <SelectItem value="CALENDAR">Agendamento</SelectItem>
                      <SelectItem value="FOLLOW_UP">Follow-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Agendamento</Label>
                  <Input
                    type="datetime-local"
                    value={config.scheduledAt}
                    onChange={(e) => setConfig({ ...config, scheduledAt: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Audience */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Upload Area */}
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  fileName ? "border-green-500 bg-green-50" : "border-gray-300 hover:border-primary hover:bg-primary/5"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                {fileName ? (
                  <div className="flex items-center justify-center gap-2 text-green-700">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">{fileName}</span>
                    <span className="text-sm">({recipients.length} contatos)</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFileName("");
                        setRecipients([]);
                        setCsvHeaders([]);
                      }}
                      className="ml-2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="font-medium text-sm">Clique para fazer upload da planilha</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Formatos aceitos: .xlsx ou .csv
                    </p>
                  </>
                )}
              </div>

              {/* Column Mapping */}
              {csvHeaders.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Mapeamento de Colunas</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Coluna de Telefone</Label>
                      <Select
                        value={config.phoneColumn}
                        onValueChange={(v) => setConfig({ ...config, phoneColumn: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Coluna de Identificação</Label>
                      <Select
                        value={config.identificationColumn}
                        onValueChange={(v) => setConfig({ ...config, identificationColumn: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Message */}
          {step === 2 && (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Mensagem Template *</Label>
                  <Textarea
                    placeholder="Olá {{nome}}, tudo bem? &#10;&#10;Gostaríamos de apresentar..."
                    value={config.templateMessage}
                    onChange={(e) => setConfig({ ...config, templateMessage: e.target.value })}
                    rows={8}
                    className="font-mono text-sm"
                  />
                </div>
                {csvHeaders.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Variáveis disponíveis:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {csvHeaders.map((h) => (
                        <button
                          key={h}
                          onClick={() =>
                            setConfig({ ...config, templateMessage: config.templateMessage + `{{${h}}}` })
                          }
                          className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-md hover:bg-primary/20"
                        >
                          {`{{${h}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Phone Preview */}
              <div className="flex flex-col items-center">
                <p className="text-xs font-medium text-muted-foreground mb-3">Preview</p>
                <div className="relative w-56 h-96 bg-gray-900 rounded-3xl overflow-hidden shadow-2xl border-4 border-gray-800">
                  <div className="absolute inset-x-2 top-2 bottom-2 bg-[#ece5dd] rounded-2xl overflow-hidden">
                    <div className="bg-[#075e54] text-white px-3 py-2 text-xs flex items-center gap-2">
                      <Smartphone className="w-3 h-3" />
                      <span className="font-medium">WhatsApp</span>
                    </div>
                    <div className="p-3 flex justify-end mt-2">
                      <div className="bg-[#dcf8c6] rounded-xl rounded-br-sm px-3 py-2 max-w-[85%] shadow-sm">
                        <p className="text-xs whitespace-pre-wrap break-words">{previewMessage}</p>
                        <p className="text-[9px] text-gray-400 text-right mt-1">12:00 ✓✓</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Send Settings */}
          {step === 3 && (
            <div className="space-y-5">
              {/* Mode */}
              <div className="space-y-3">
                <Label>Modo de Envio</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "DEFAULT", label: "Modo Padrão (Humano)", desc: "Simula comportamento humano com delays" },
                    { value: "PARALLEL", label: "Modo Paralelo (Alta Velocidade)", desc: "Envio rápido em paralelo" },
                  ].map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setConfig({ ...config, mode: m.value })}
                      className={cn(
                        "p-3 rounded-lg border-2 text-left transition-colors",
                        config.mode === m.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-gray-300"
                      )}
                    >
                      <p className="font-medium text-sm">{m.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rate */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Limite de Envios por Minuto</Label>
                  <span className="text-sm font-semibold text-primary">
                    {config.maxMessagesPerMinute} msg/min
                  </span>
                </div>
                <Slider
                  min={1}
                  max={60}
                  step={1}
                  value={[config.maxMessagesPerMinute]}
                  onValueChange={([v]) => setConfig({ ...config, maxMessagesPerMinute: v })}
                />
              </div>

              {/* Advanced */}
              <Accordion type="single" collapsible>
                <AccordionItem value="advanced">
                  <AccordionTrigger className="text-sm">Configuração Avançada</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Delay mínimo (s)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={300}
                            value={config.minDelaySeconds}
                            onChange={(e) =>
                              setConfig({ ...config, minDelaySeconds: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Delay máximo (s)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={300}
                            value={config.maxDelaySeconds}
                            onChange={(e) =>
                              setConfig({ ...config, maxDelaySeconds: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Horário Início</Label>
                          <Input
                            type="time"
                            value={config.dailyStartTime}
                            onChange={(e) =>
                              setConfig({ ...config, dailyStartTime: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Horário Fim</Label>
                          <Input
                            type="time"
                            value={config.dailyEndTime}
                            onChange={(e) =>
                              setConfig({ ...config, dailyEndTime: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Governance */}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Pular conversas ativas</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Ignora contatos com interação nos últimos 7 dias
                    </p>
                  </div>
                  <Switch
                    checked={config.skipExistingConversation}
                    onCheckedChange={(v) =>
                      setConfig({ ...config, skipExistingConversation: v })
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm font-medium text-destructive mb-1">
                Corrija os erros do formulário para continuar:
              </p>
              <ul className="text-sm text-destructive list-disc list-inside space-y-0.5">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => step === 0 ? router.back() : setStep((s) => s - 1)}
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          {step === 0 ? "Cancelar" : "Voltar"}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={handleNext}>
            Próximo
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={creating}>
            {creating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Criar Campanha
          </Button>
        )}
      </div>
    </div>
  );
}
