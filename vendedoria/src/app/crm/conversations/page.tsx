"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  MessageSquare, Search, RefreshCw, Phone, Clock, AlertTriangle,
  CheckCircle2, XCircle, ChevronRight, Loader2, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const GET_ORGS = gql`
  query GetOrgsConversations {
    whatsappBusinessOrganizations { id name status }
  }
`;

interface LastMessage { content: string; role: string; sentAt: string; type: string }
interface FollowUp { status: string; step: number; nextSendAt: string }
interface Lead { id: string; profileName: string | null; phoneNumber: string; status: string }
interface Conversation {
  id: string;
  customerWhatsappBusinessId: string;
  profileName: string | null;
  lastMessageAt: string | null;
  isActive: boolean;
  lead: Lead | null;
  messages: LastMessage[];
  followUp: FollowUp | null;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700",
  ESCALATED: "bg-orange-100 text-orange-700",
  BLOCKED: "bg-red-100 text-red-700",
  CLOSED: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  ESCALATED: "Escalado",
  BLOCKED: "Bloqueado",
  CLOSED: "Fechado",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ConversationsPage() {
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];

  const [orgId, setOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; content: string; role: string; sentAt: string; type: string }>>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orgId && orgs.length > 0) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  const fetchConversations = useCallback(async (reset = true) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const cursor = reset ? "" : (nextCursor ?? "");
      const params = new URLSearchParams({ organizationId: orgId, status: statusFilter });
      if (search) params.set("search", search);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/conversations?${params}`);
      const data = await res.json();
      setConversations(prev => reset ? data.conversations : [...prev, ...data.conversations]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [orgId, search, statusFilter, nextCursor]);

  // Initial load + search/filter changes
  useEffect(() => { fetchConversations(true); }, [orgId, search, statusFilter]);

  // Poll every 10s for real-time updates
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchConversations(true), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchConversations]);

  // Load messages for selected conversation
  const fetchMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id: String!) {
            getConversationMessages(conversationId: $id) {
              id content type role sentAt
            }
          }`,
          variables: { id: convId },
        }),
      });
      const { data } = await res.json();
      setMessages(data?.getConversationMessages ?? []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchMessages(selectedId);
  }, [selectedId, fetchMessages]);

  // Poll messages every 5s when a conversation is open
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => fetchMessages(selectedId), 5000);
    return () => clearInterval(t);
  }, [selectedId, fetchMessages]);

  const selected = conversations.find(c => c.id === selectedId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — conversation list */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-white">
        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Conversas</h2>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchConversations(true)} disabled={loading}>
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </Button>
          </div>
          {orgs.length > 1 && (
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou número..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {[["all","Todos"],["open","Abertos"],["escalated","Escalados"],["blocked","Bloqueados"]].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs border transition-colors",
                  statusFilter === v ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">Nenhuma conversa encontrada</p>
            </div>
          )}
          {conversations.map(conv => {
            const lastMsg = conv.messages[0];
            const leadStatus = conv.lead?.status ?? "OPEN";
            return (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors",
                  selectedId === conv.id && "bg-primary/5 border-l-2 border-l-primary"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">
                        {conv.lead?.profileName ?? conv.profileName ?? conv.customerWhatsappBusinessId}
                      </p>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0", STATUS_COLORS[leadStatus])}>
                        {STATUS_LABELS[leadStatus] ?? leadStatus}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {conv.lead?.phoneNumber ?? conv.customerWhatsappBusinessId}
                    </p>
                    {lastMsg && (
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {lastMsg.role === "ASSISTANT" ? "🤖 " : "👤 "}
                        {lastMsg.type === "TEXT" ? lastMsg.content.slice(0, 60) : `[${lastMsg.type}]`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] text-muted-foreground">{timeAgo(conv.lastMessageAt)}</span>
                    {conv.followUp?.status === "ACTIVE" && (
                      <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />F{conv.followUp.step}
                      </span>
                    )}
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </div>
                </div>
              </button>
            );
          })}
          {hasMore && (
            <button
              onClick={() => fetchConversations(false)}
              className="w-full py-3 text-xs text-primary hover:underline"
            >
              Carregar mais
            </button>
          )}
        </div>
      </div>

      {/* Right panel — messages */}
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="bg-white border-b border-border px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">
                  {selected.lead?.profileName ?? selected.profileName ?? selected.customerWhatsappBusinessId}
                </h3>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" />
                  {selected.lead?.phoneNumber ?? selected.customerWhatsappBusinessId}
                  {selected.followUp?.status === "ACTIVE" && (
                    <span className="ml-2 text-amber-600">• Follow-up etapa {selected.followUp.step} agendado</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.lead?.status && (
                  <Badge className={cn("text-xs", STATUS_COLORS[selected.lead.status])}>
                    {STATUS_LABELS[selected.lead.status]}
                  </Badge>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchMessages(selected.id)}>
                  <RefreshCw className={cn("w-3.5 h-3.5", loadingMessages && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {loadingMessages && messages.length === 0 && (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={cn("flex", msg.role === "ASSISTANT" ? "justify-start" : "justify-end")}>
                  <div className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                    msg.role === "ASSISTANT"
                      ? "bg-white text-foreground rounded-tl-none"
                      : "bg-primary text-white rounded-tr-none"
                  )}>
                    {msg.type === "TEXT" ? (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    ) : (
                      <p className="italic opacity-70">[{msg.type}]</p>
                    )}
                    <p className={cn(
                      "text-[10px] mt-1 text-right",
                      msg.role === "ASSISTANT" ? "text-muted-foreground" : "text-white/70"
                    )}>
                      {new Date(msg.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
