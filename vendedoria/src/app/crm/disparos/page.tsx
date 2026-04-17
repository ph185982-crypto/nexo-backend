"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  Send, Search, CheckSquare, Square, Loader2, CheckCircle, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const GET_ORGS = gql`
  query GetOrgsDisparos {
    whatsappBusinessOrganizations {
      id
      name
      accounts {
        id
        accountName
        displayPhoneNumber
        businessPhoneNumberId
        status
      }
    }
  }
`;

interface Lead {
  id: string;
  phoneNumber: string;
  profileName: string | null;
  status: string;
  kanbanColumn: { id: string; name: string; color: string } | null;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
  lastActivityAt: string | null;
}

interface Org {
  id: string;
  name: string;
  accounts: Array<{
    id: string;
    accountName: string;
    displayPhoneNumber: string;
    businessPhoneNumberId: string;
    status: string;
  }>;
}

interface SendResult {
  leadId: string;
  phone: string;
  name: string | null;
  status: "sent" | "failed";
  error?: string;
}

export default function DisparosPage() {
  const { data: orgsData } = useQuery(GET_ORGS, { fetchPolicy: "cache-and-network" });
  const orgs: Org[] = orgsData?.whatsappBusinessOrganizations ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [search, setSearch] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{
    sent: number;
    failed: number;
    details: SendResult[];
  } | null>(null);

  // Auto-select first org
  useEffect(() => {
    if (orgs.length && !selectedOrgId) {
      setSelectedOrgId(orgs[0].id);
    }
  }, [orgs, selectedOrgId]);

  // Auto-select first account of selected org
  useEffect(() => {
    const org = orgs.find((o) => o.id === selectedOrgId);
    if (org?.accounts?.length && !selectedAccountId) {
      setSelectedAccountId(org.accounts[0].id);
    }
  }, [selectedOrgId, orgs, selectedAccountId]);

  // Fetch leads whenever org changes
  useEffect(() => {
    if (!selectedOrgId) return;
    setLoadingLeads(true);
    setSelectedLeadIds(new Set());
    setResults(null);
    fetch(`/api/leads?organizationId=${selectedOrgId}`)
      .then((r) => r.json())
      .then((data) => {
        setLeads(Array.isArray(data) ? data : []);
        setLoadingLeads(false);
      })
      .catch(() => setLoadingLeads(false));
  }, [selectedOrgId]);

  const columns = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    leads.forEach((l) => {
      if (l.kanbanColumn) map.set(l.kanbanColumn.id, { name: l.kanbanColumn.name, color: l.kanbanColumn.color });
    });
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (filterColumn && l.kanbanColumn?.id !== filterColumn) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.profileName?.toLowerCase().includes(q) || l.phoneNumber.includes(q);
      }
      return true;
    });
  }, [leads, search, filterColumn]);

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);
  const selectedAccount = selectedOrg?.accounts?.find((a) => a.id === selectedAccountId);

  const allSelected = filteredLeads.length > 0 && selectedLeadIds.size === filteredLeads.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const toggleLead = (id: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (!selectedAccount || !message.trim() || selectedLeadIds.size === 0) return;
    setSending(true);
    setResults(null);
    try {
      const res = await fetch("/api/disparos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          phoneNumberId: selectedAccount.businessPhoneNumberId,
          leadIds: Array.from(selectedLeadIds),
          message: message.trim(),
        }),
      });
      const data = await res.json();
      setResults({
        sent: data.sent ?? 0,
        failed: data.failed ?? 0,
        details: data.results ?? [],
      });
    } catch {
      setResults({ sent: 0, failed: selectedLeadIds.size, details: [] });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center gap-3 flex-shrink-0">
        <Send className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Disparos</h1>
        <p className="text-sm text-muted-foreground hidden sm:block">Envie mensagens para múltiplos contatos</p>
        {leads.length > 0 && (
          <Badge variant="outline" className="ml-auto">{leads.length} contatos</Badge>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Lead selector */}
        <div className="flex-1 flex flex-col border-r overflow-hidden min-w-0">
          {/* Filters */}
          <div className="p-3 border-b flex gap-2 flex-shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterColumn} onValueChange={setFilterColumn}>
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue placeholder="Coluna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas as colunas</SelectItem>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Select-all bar */}
          <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/30 flex-shrink-0">
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {allSelected
                ? <CheckSquare className="w-4 h-4 text-primary" />
                : <Square className="w-4 h-4" />}
              <span>{allSelected ? "Desmarcar todos" : `Selecionar todos (${filteredLeads.length})`}</span>
            </button>
            {selectedLeadIds.size > 0 && (
              <Badge className="ml-auto">{selectedLeadIds.size} selecionado{selectedLeadIds.size !== 1 ? "s" : ""}</Badge>
            )}
          </div>

          {/* Lead list */}
          <div className="flex-1 overflow-y-auto">
            {loadingLeads ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Carregando contatos...</span>
              </div>
            ) : !selectedOrgId ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                Selecione uma organização para ver os contatos
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                Nenhum contato encontrado
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const selected = selectedLeadIds.has(lead.id);
                return (
                  <div
                    key={lead.id}
                    onClick={() => toggleLead(lead.id)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 border-b cursor-pointer hover:bg-muted/40 transition-colors select-none",
                      selected && "bg-primary/5"
                    )}
                  >
                    <div className="shrink-0">
                      {selected
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {lead.profileName || lead.phoneNumber}
                      </p>
                      {lead.profileName && (
                        <p className="text-xs text-muted-foreground">{lead.phoneNumber}</p>
                      )}
                    </div>
                    {lead.kanbanColumn && (
                      <span
                        className="shrink-0 px-2 py-0.5 rounded-full text-xs text-white whitespace-nowrap"
                        style={{ backgroundColor: lead.kanbanColumn.color || "#6b7280" }}
                      >
                        {lead.kanbanColumn.name}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel: Compose + Send */}
        <div className="w-80 shrink-0 flex flex-col p-4 gap-4 overflow-y-auto border-l">
          {/* Org select */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Organização</label>
            <Select
              value={selectedOrgId}
              onValueChange={(v) => {
                setSelectedOrgId(v);
                setSelectedAccountId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a organização" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Account select */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Conta WhatsApp</label>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                {(selectedOrg?.accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.accountName} ({a.displayPhoneNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Mensagem</label>
            <Textarea
              placeholder="Digite a mensagem que será enviada para os contatos selecionados..."
              rows={8}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">{message.length} caracteres</p>
          </div>

          {/* Send button */}
          <Button
            className="w-full"
            disabled={!message.trim() || selectedLeadIds.size === 0 || !selectedAccount || sending}
            onClick={handleSend}
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                {selectedLeadIds.size === 0
                  ? "Selecione contatos"
                  : `Enviar para ${selectedLeadIds.size} contato${selectedLeadIds.size !== 1 ? "s" : ""}`}
              </>
            )}
          </Button>

          {/* Results */}
          {results && (
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm">Resultado do disparo</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-2">
                <div className="flex gap-4">
                  <div className="flex items-center gap-1.5 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{results.sent} enviados</span>
                  </div>
                  {results.failed > 0 && (
                    <div className="flex items-center gap-1.5 text-red-500">
                      <XCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">{results.failed} falhas</span>
                    </div>
                  )}
                </div>
                {results.details
                  .filter((r) => r.status === "failed")
                  .map((r) => (
                    <div key={r.leadId} className="text-xs text-red-600 bg-red-50 rounded p-1.5 break-words">
                      {r.name || r.phone}: {r.error}
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
