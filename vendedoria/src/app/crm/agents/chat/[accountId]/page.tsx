"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Search, Send, Smile, Phone, MoreVertical, Filter,
  Tag, CheckCheck, Check, Loader2, Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cn, getInitials, getAvatarColor, formatPhone, formatTime, relativeTime,
} from "@/lib/utils";

const GET_CONVERSATIONS = gql`
  query GetConvs($accountId: String!, $cursor: String) {
    getConversationsByWhatsappAccount(accountId: $accountId, cursor: $cursor) {
      conversations {
        id profileName leadOrigin isActive lastMessageAt unreadCount
        lead { id phoneNumber profileName status }
        lastMessage { id content role sentAt }
        tags { id name color }
      }
      hasMore nextCursor total
    }
  }
`;

const GET_MESSAGES = gql`
  query GetMessages($conversationId: String!, $cursor: String) {
    getConversationMessages(conversationId: $conversationId, cursor: $cursor) {
      messages { id content type role sentAt status }
      hasMore nextCursor
    }
  }
`;

const SEND_MESSAGE = gql`
  mutation SendMsg($conversationId: String!, $content: String!) {
    sendWhatsappMessage(conversationId: $conversationId, content: $content) {
      id content role sentAt status
    }
  }
`;

interface Conversation {
  id: string;
  profileName?: string;
  leadOrigin: string;
  isActive: boolean;
  lastMessageAt?: string;
  unreadCount?: number;
  lead?: { id: string; phoneNumber: string; profileName?: string; status: string };
  lastMessage?: { id: string; content: string; role: string; sentAt: string };
  tags?: Array<{ id: string; name: string; color: string }>;
}

interface Message {
  id: string;
  content: string;
  type: string;
  role: string;
  sentAt: string;
  status: string;
}

function ConversationItem({
  conv,
  selected,
  onClick,
}: {
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  const name = conv.profileName ?? conv.lead?.profileName ?? conv.lead?.phoneNumber ?? "Desconhecido";
  const avatarColor = getAvatarColor(name);
  const initials = getInitials(name);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100",
        selected && "bg-primary/5 border-l-2 border-l-primary"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <Avatar className="w-10 h-10">
            <AvatarFallback
              className="text-white text-sm font-semibold"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          {conv.isActive && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-medium text-sm truncate">{name}</span>
            {conv.lastMessageAt && (
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {relativeTime(conv.lastMessageAt)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {conv.lastMessage?.content ?? "Nenhuma mensagem"}
          </p>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {conv.tags?.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="px-1.5 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {(conv.unreadCount ?? 0) > 0 && (
              <span className="ml-auto bg-primary text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isSent = message.role === "ASSISTANT";

  return (
    <div className={cn("flex", isSent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm",
          isSent
            ? "bg-[#dcf8c6] rounded-br-sm"
            : "bg-white rounded-bl-sm border border-gray-100"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div className={cn("flex items-center gap-1 mt-1", isSent ? "justify-end" : "justify-start")}>
          <span className="text-[10px] text-gray-400">{formatTime(message.sentAt)}</span>
          {isSent && (
            message.status === "READ"
              ? <CheckCheck className="w-3 h-3 text-blue-500" />
              : <Check className="w-3 h-3 text-gray-400" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: convData, loading: convLoading } = useQuery(GET_CONVERSATIONS, {
    variables: { accountId },
    fetchPolicy: "cache-and-network",
    pollInterval: 5000,
  });

  const { data: msgData, loading: msgLoading, fetchMore } = useQuery(GET_MESSAGES, {
    variables: { conversationId: selectedConvId ?? "" },
    skip: !selectedConvId,
    fetchPolicy: "cache-and-network",
    pollInterval: 3000,
  });

  const [sendMessage, { loading: sending }] = useMutation(SEND_MESSAGE, {
    update(cache, { data: { sendWhatsappMessage: newMsg } }) {
      const existing = cache.readQuery<{ getConversationMessages: { messages: Message[] } }>({
        query: GET_MESSAGES,
        variables: { conversationId: selectedConvId },
      });
      if (existing) {
        cache.writeQuery({
          query: GET_MESSAGES,
          variables: { conversationId: selectedConvId },
          data: {
            getConversationMessages: {
              ...existing.getConversationMessages,
              messages: [...existing.getConversationMessages.messages, newMsg],
            },
          },
        });
      }
    },
  });

  const conversations: Conversation[] = convData?.getConversationsByWhatsappAccount?.conversations ?? [];
  const messages: Message[] = msgData?.getConversationMessages?.messages ?? [];
  const hasMoreMessages = msgData?.getConversationMessages?.hasMore ?? false;

  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  const filteredConvs = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = c.profileName ?? c.lead?.profileName ?? "";
    return name.toLowerCase().includes(q) || c.lead?.phoneNumber.includes(q);
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedConvId || sending) return;
    const content = messageInput.trim();
    setMessageInput("");
    await sendMessage({ variables: { conversationId: selectedConvId, content } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedName =
    selectedConv?.profileName ??
    selectedConv?.lead?.profileName ??
    selectedConv?.lead?.phoneNumber ??
    "Contato";

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* Left Panel: Conversations */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col">
        {/* Search */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-gray-50 border-gray-200"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {convLoading && conversations.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhuma conversa
            </div>
          ) : (
            filteredConvs.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                selected={conv.id === selectedConvId}
                onClick={() => setSelectedConvId(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Chat */}
      {selectedConvId && selectedConv ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="h-16 border-b border-gray-200 px-4 flex items-center justify-between flex-shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <Avatar className="w-9 h-9">
                <AvatarFallback
                  className="text-white text-sm font-semibold"
                  style={{ backgroundColor: getAvatarColor(selectedName) }}
                >
                  {getInitials(selectedName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm">{selectedName}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="success" className="text-xs px-1.5 py-0">
                    Ativo
                  </Badge>
                  {selectedConv.lead?.phoneNumber && (
                    <span className="text-xs text-muted-foreground">
                      {formatPhone(selectedConv.lead.phoneNumber)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm">
                <Tag className="w-4 h-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Reportar Problema</DropdownMenuItem>
                  <DropdownMenuItem className="text-orange-600">Encerrar Lead</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">Bloquear Lead</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Messages Area */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-2"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23e5e7eb' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")", backgroundColor: "#f0f4f8" }}
          >
            {hasMoreMessages && (
              <div className="text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    fetchMore({
                      variables: { cursor: msgData?.getConversationMessages?.nextCursor },
                    })
                  }
                >
                  Carregar mais mensagens
                </Button>
              </div>
            )}

            {msgLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <div className="border-t border-gray-200 p-3 flex items-end gap-2 bg-white flex-shrink-0">
            <Button variant="ghost" size="icon" className="text-muted-foreground flex-shrink-0">
              <Smile className="w-5 h-5" />
            </Button>
            <Input
              placeholder="Digite uma mensagem..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 resize-none"
              disabled={sending}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!messageInput.trim() || sending}
              className="flex-shrink-0"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-gray-50">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
            <Bot className="w-10 h-10 text-primary" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-lg text-foreground">Nexo Vendas</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Selecione uma conversa para começar
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
