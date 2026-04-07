"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  MessageSquare, Search, RefreshCw, Phone, Clock,
  ChevronRight, Loader2, Send, Bot, UserCheck,
  AlertTriangle, CheckCheck, Check, Image as ImageIcon, Video, ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── GraphQL ───────────────────────────────────────────────────────────────────

const GET_ORGS = gql`
  query GetOrgsConversations {
    whatsappBusinessOrganizations { id name status }
  }
`;

const SEND_MESSAGE = gql`
  mutation SendMessage($conversationId: String!, $content: String!) {
    sendWhatsappMessage(conversationId: $conversationId, content: $content) {
      id content type role sentAt status
    }
  }
`;

const TAKEOVER = gql`
  mutation Takeover($conversationId: String!, $takeover: Boolean!) {
    takeoverConversation(conversationId: $conversationId, takeover: $takeover) {
      id humanTakeover
    }
  }
`;

const DEESCALATE = gql`
  mutation Deescalate($conversationId: String!) {
    deescalateConversation(conversationId: $conversationId) {
      id humanTakeover lead { id status }
    }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface LastMessage { content: string; role: string; sentAt: string; type: string }
interface FollowUp { status: string; step: number; nextSendAt: string }
interface Lead { id: string; profileName: string | null; phoneNumber: string; status: string }
interface Conversation {
  id: string;
  customerWhatsappBusinessId: string;
  profileName: string | null;
  lastMessageAt: string | null;
  isActive: boolean;
  humanTakeover: boolean;
  lead: Lead | null;
  messages: LastMessage[];
  followUp: FollowUp | null;
}
interface Message {
  id: string; content: string; role: string; sentAt: string; type: string; status?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700",
  ESCALATED: "bg-orange-100 text-orange-700",
  BLOCKED: "bg-red-100 text-red-700",
  CLOSED: "bg-gray-100 text-gray-600",
};
const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto", ESCALATED: "Escalado", BLOCKED: "Bloqueado", CLOSED: "Fechado",
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function MessageContent({ msg }: { msg: Message }) {
  if (msg.type === "IMAGE") return <span className="flex items-center gap-1 italic opacity-80"><ImageIcon className="w-3.5 h-3.5" /> Imagem</span>;
  if (msg.type === "VIDEO") return <span className="flex items-center gap-1 italic opacity-80"><Video className="w-3.5 h-3.5" /> Vídeo</span>;
  if (msg.type === "AUDIO") return <span className="italic opacity-80">🎙 Áudio</span>;
  return <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>;
}

// ── Main Component ────────────────────────────────────────────────────────────

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [deescalating, setDeescalating] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  const [sendMessage] = useMutation(SEND_MESSAGE);
  const [takeoverMutation] = useMutation(TAKEOVER);
  const [deescalateMutation] = useMutation(DEESCALATE);

  useEffect(() => {
    if (!orgId && orgs.length > 0) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  // ── Fetch conversation list ──────────────────────────────────────────────────
  const fetchConversations = useCallback(async (reset = true) => {
    if (!orgId) return;
    if (reset) setLoading(true);
    try {
      const cursor = reset ? "" : (nextCursor ?? "");
      const params = new URLSearchParams({ organizationId: orgId, status: statusFilter });
      if (search) params.set("search", search);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/conversations?${params}`);
      const data = await res.json() as { conversations: Conversation[]; hasMore: boolean; nextCursor: string | null };
      setConversations(prev => reset ? data.conversations : [...prev, ...data.conversations]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } finally {
      if (reset) setLoading(false);
    }
  }, [orgId, search, statusFilter, nextCursor]);

  useEffect(() => { fetchConversations(true); }, [orgId, search, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => fetchConversations(true), 5000);
    return () => clearInterval(t);
  }, [fetchConversations]);

  // ── Fetch messages ───────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const res = await fetch(`/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id: String!) {
            getConversationMessages(conversationId: $id) {
              messages { id content type role sentAt status }
            }
          }`,
          variables: { id: convId },
        }),
      });
      const { data } = await res.json() as { data?: { getConversationMessages?: { messages?: Message[] } } };
      const newMsgs = data?.getConversationMessages?.messages ?? [];
      setMessages(newMsgs);
      // Auto-scroll only when new messages arrive
      if (newMsgs.length !== prevMsgCountRef.current) {
        prevMsgCountRef.current = newMsgs.length;
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
      }
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) { prevMsgCountRef.current = 0; fetchMessages(selectedId); }
  }, [selectedId, fetchMessages]);

  // Poll messages every 3s when open
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => fetchMessages(selectedId, true), 3000);
    return () => clearInterval(t);
  }, [selectedId, fetchMessages]);

  // ── De-escalate ──────────────────────────────────────────────────────────────
  const handleDeescalate = useCallback(async () => {
    if (!selectedId || deescalating) return;
    setDeescalating(true);
    try {
      await deescalateMutation({ variables: { conversationId: selectedId } });
      setConversations(prev => prev.map(c =>
        c.id === selectedId
          ? { ...c, humanTakeover: false, lead: c.lead ? { ...c.lead, status: "OPEN" } : c.lead }
          : c
      ));
    } finally {
      setDeescalating(false);
    }
  }, [selectedId, deescalating, deescalateMutation]);

  // ── Selected conversation ───────────────────────────────────────────────────
  const selected = conversations.find(c => c.id === selectedId);
  const isHumanControl = selected?.humanTakeover ?? false;
  const isEscalated = selected?.lead?.status === "ESCALATED";

  // ── Send message ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const content = msgInput.trim();
    if (!content || !selectedId || sending) return;
    setMsgInput("");
    setSending(true);

    // Optimistic update
    const optimistic: Message = {
      id: `opt-${Date.now()}`, content, role: "ASSISTANT", sentAt: new Date().toISOString(), type: "TEXT", status: "SENDING",
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      await sendMessage({ variables: { conversationId: selectedId, content } });
      await fetchMessages(selectedId, true);
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setMsgInput(content); // restore
    } finally {
      setSending(false);
    }
  }, [msgInput, selectedId, sending, sendMessage, fetchMessages]);

  // ── Takeover toggle ─────────────────────────────────────────────────────────
  const handleTakeover = useCallback(async (takeover: boolean) => {
    if (!selectedId || takingOver) return;
    setTakingOver(true);
    try {
      await takeoverMutation({ variables: { conversationId: selectedId, takeover } });
      // Update local state immediately
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, humanTakeover: takeover } : c));
    } finally {
      setTakingOver(false);
    }
  }, [selectedId, takingOver, takeoverMutation]);

  return (
    <div className="flex h-full overflow-hidden bg-background">

      {/* ── LEFT: Conversation list ─────────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col bg-white">
        {/* Header */}
        <div className="p-3 border-b space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Conversas</h2>
            <div className="flex items-center gap-1">
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchConversations(true)}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {orgs.length > 1 && (
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="h-8 pl-8 text-xs" />
          </div>

          <div className="flex gap-1 flex-wrap">
            {[["all","Todos"],["open","Abertos"],["escalated","Escalados"],["blocked","Bloqueados"]].map(([v,l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                className={cn("px-2 py-0.5 rounded text-xs border transition-colors",
                  statusFilter === v ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
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
              <p className="text-xs">Nenhuma conversa</p>
            </div>
          )}
          {conversations.map(conv => {
            const lastMsg = conv.messages[0];
            const leadStatus = conv.lead?.status ?? "OPEN";
            const isSelected = selectedId === conv.id;
            return (
              <button key={conv.id} onClick={() => setSelectedId(conv.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b hover:bg-muted/40 transition-colors",
                  isSelected && "bg-primary/5 border-l-2 border-l-primary"
                )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {conv.lead?.profileName ?? conv.profileName ?? conv.customerWhatsappBusinessId}
                      </p>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0", STATUS_COLORS[leadStatus])}>
                        {STATUS_LABELS[leadStatus] ?? leadStatus}
                      </span>
                      {conv.humanTakeover && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                          👤 Você
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{conv.lead?.phoneNumber ?? conv.customerWhatsappBusinessId}</span>
                    </p>
                    {lastMsg && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {lastMsg.role === "ASSISTANT" ? (conv.humanTakeover ? "👤 " : "🤖 ") : "💬 "}
                        {lastMsg.type === "TEXT" ? lastMsg.content.slice(0, 55) : `[${lastMsg.type}]`}
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
            <button onClick={() => fetchConversations(false)} className="w-full py-3 text-xs text-primary hover:underline">
              Carregar mais
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT: Chat detail ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#f0f2f5]">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MessageSquare className="w-14 h-14 opacity-20" />
            <p className="text-sm">Selecione uma conversa para ver o chat</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white border-b px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0 shadow-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm">
                    {selected.lead?.profileName ?? selected.profileName ?? selected.customerWhatsappBusinessId}
                  </h3>
                  {selected.lead?.status && (
                    <Badge className={cn("text-xs", STATUS_COLORS[selected.lead.status])}>
                      {STATUS_LABELS[selected.lead.status]}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" />
                  {selected.lead?.phoneNumber ?? selected.customerWhatsappBusinessId}
                  {selected.followUp?.status === "ACTIVE" && (
                    <span className="ml-2 text-amber-600">· Follow-up etapa {selected.followUp.step}</span>
                  )}
                </p>
              </div>

              {/* Takeover / Escalation controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {isEscalated ? (
                  /* ── Escalated state ── */
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Escalado para humano
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDeescalate}
                      disabled={deescalating}
                      className="h-8 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      {deescalating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                      De-escalar (voltar IA)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTakeover(true)}
                      disabled={takingOver}
                      className="h-8 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                    >
                      {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                      Assumir eu mesmo
                    </Button>
                  </div>
                ) : isHumanControl ? (
                  /* ── Human in control ── */
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium">
                      <UserCheck className="w-3.5 h-3.5" />
                      Você está no controle
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTakeover(false)}
                      disabled={takingOver}
                      className="h-8 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                      Devolver para IA
                    </Button>
                  </div>
                ) : (
                  /* ── AI active ── */
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 font-medium">
                      <Bot className="w-3.5 h-3.5" />
                      IA ativa
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTakeover(true)}
                      disabled={takingOver}
                      className="h-8 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                    >
                      {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                      Tomar controle
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Control banners */}
            {isEscalated && (
              <div className="bg-orange-500 text-white text-xs px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span><strong>Conversa escalada.</strong> A IA parou de responder. Clique em <strong>De-escalar (voltar IA)</strong> para reativar o Pedro, ou <strong>Assumir eu mesmo</strong> para responder você.</span>
              </div>
            )}
            {!isEscalated && isHumanControl && (
              <div className="bg-blue-600 text-white text-xs px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span><strong>IA pausada.</strong> Você está respondendo manualmente. O Pedro não vai interferir enquanto você estiver no controle.</span>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {loadingMessages && messages.length === 0 && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {messages.map((msg, i) => {
                const isMe = msg.role === "ASSISTANT";
                const prevMsg = messages[i - 1];
                const showTime = !prevMsg || (new Date(msg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime()) > 5 * 60 * 1000;

                return (
                  <React.Fragment key={msg.id}>
                    {showTime && (
                      <div className="flex justify-center my-2">
                        <span className="text-[11px] text-muted-foreground bg-white/70 px-2.5 py-0.5 rounded-full shadow-sm">
                          {new Date(msg.sentAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} {formatTime(msg.sentAt)}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                        isMe
                          ? "bg-[#dcf8c6] text-gray-800 rounded-tr-sm"
                          : "bg-white text-gray-800 rounded-tl-sm"
                      )}>
                        <MessageContent msg={msg} />
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <span className="text-[10px] text-gray-400">{formatTime(msg.sentAt)}</span>
                          {isMe && (
                            msg.status === "SENDING"
                              ? <Clock className="w-3 h-3 text-gray-400" />
                              : msg.status === "READ"
                              ? <CheckCheck className="w-3 h-3 text-blue-500" />
                              : <Check className="w-3 h-3 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div className="bg-white border-t px-3 py-2.5 flex-shrink-0">
              {!isHumanControl && (
                <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  IA está respondendo automaticamente. Clique em <strong className="mx-0.5">Tomar controle</strong> para responder manualmente.
                </p>
              )}
              <div className="flex gap-2 items-end">
                <Textarea
                  value={msgInput}
                  onChange={e => setMsgInput(e.target.value)}
                  placeholder={isHumanControl ? "Digite sua mensagem..." : "Mensagem (IA ativa — tome controle para enviar)"}
                  className="min-h-[42px] max-h-[120px] resize-none text-sm flex-1"
                  disabled={!isHumanControl && false} // always enabled so you can type ahead
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={sending || !msgInput.trim()}
                  className={cn(
                    "h-11 w-11 flex-shrink-0 transition-colors",
                    isHumanControl ? "bg-blue-600 hover:bg-blue-700" : "bg-primary hover:bg-primary/90"
                  )}
                  title={isHumanControl ? "Enviar como você" : "Enviar (IA ativa)"}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 px-0.5">Enter para enviar · Shift+Enter nova linha</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
