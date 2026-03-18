"use client";

import React from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Phone, Mail, MapPin, Calendar, Tag, MessageSquare, User,
  MoreVertical, X, Clock, AlertTriangle, Ban, ChevronRight,
  Bot, Loader2,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, getInitials, getAvatarColor, formatDate, formatDateTime, relativeTime, formatPhone } from "@/lib/utils";

// ─── GraphQL Documents ────────────────────────────────────────────────────────

const CLOSE_LEAD = gql`
  mutation CloseLead($leadId: String!) {
    closeLead(leadId: $leadId) { id status }
  }
`;

const BLOCK_LEAD = gql`
  mutation BlockLead($leadId: String!) {
    blockLead(leadId: $leadId) { id status }
  }
`;

const GET_LEAD_CONVERSATIONS = gql`
  query LeadConversations($leadId: String!) {
    getConversationsByLead(leadId: $leadId) {
      id profileName leadOrigin isActive lastMessageAt createdAt
      whatsappProviderConfigId
      provider { id accountName displayPhoneNumber }
      lastMessage { id content role sentAt }
      tags { id name color }
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  phoneNumber: string;
  profileName?: string;
  email?: string;
  location?: string;
  leadOrigin: string;
  status: string;
  kanbanColumn?: { name: string; color: string };
  tags?: Array<{ id: string; name: string; color: string }>;
  activities?: Array<{ id: string; type: string; description: string; createdAt: string }>;
  escalations?: Array<{ id: string; reason?: string; status: string; createdAt: string }>;
  createdAt: string;
  lastActivityAt?: string;
}

interface Conversation {
  id: string;
  profileName?: string | null;
  leadOrigin: string;
  isActive: boolean;
  lastMessageAt?: string | null;
  createdAt: string;
  whatsappProviderConfigId: string;
  provider?: { id: string; accountName: string; displayPhoneNumber: string } | null;
  lastMessage?: { id: string; content: string; role: string; sentAt: string } | null;
  tags?: Array<{ id: string; name: string; color: string }>;
}

interface LeadDetailModalProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onOpenChat?: (accountId: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LeadDetailModal({ lead, open, onClose, onOpenChat }: LeadDetailModalProps) {
  const [closeLead] = useMutation(CLOSE_LEAD);
  const [blockLead] = useMutation(BLOCK_LEAD);

  const { data: convsData, loading: convsLoading } = useQuery(GET_LEAD_CONVERSATIONS, {
    variables: { leadId: lead?.id ?? "" },
    skip: !lead?.id || !open,
    fetchPolicy: "cache-and-network",
  });

  if (!lead) return null;

  const avatarColor = getAvatarColor(lead.profileName);
  const initials = getInitials(lead.profileName ?? lead.phoneNumber);
  const conversations: Conversation[] = convsData?.getConversationsByLead ?? [];

  const handleClose = async () => {
    await closeLead({ variables: { leadId: lead.id } });
    onClose();
  };

  const handleBlock = async () => {
    await blockLead({ variables: { leadId: lead.id } });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="p-6 pb-4 border-b">
          <div className="flex items-start gap-4">
            <Avatar className="w-14 h-14 flex-shrink-0">
              <AvatarFallback
                className="text-white text-lg font-bold"
                style={{ backgroundColor: avatarColor }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold">
                    {lead.profileName ?? "Sem nome"}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={lead.leadOrigin === "INBOUND" ? "success" : "info"}>
                      {lead.leadOrigin === "INBOUND" ? "Entrada" : "Saída"}
                    </Badge>
                    {lead.kanbanColumn && (
                      <Badge
                        variant="outline"
                        style={{ borderColor: lead.kanbanColumn.color, color: lead.kanbanColumn.color }}
                      >
                        {lead.kanbanColumn.name}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Criado {relativeTime(lead.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-muted-foreground">
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      Reportar Problema
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleClose} className="text-orange-600">
                      <X className="w-4 h-4 mr-2" />
                      Encerrar Lead
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBlock} className="text-destructive">
                      <Ban className="w-4 h-4 mr-2" />
                      Bloquear Lead
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    const firstConv = conversations[0];
                    if (firstConv && onOpenChat) {
                      onOpenChat(firstConv.whatsappProviderConfigId);
                      onClose();
                    }
                  }}
                  disabled={conversations.length === 0}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Mensagem
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Phone className="w-3.5 h-3.5" />
                  Ligar
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="mx-6 mt-3 w-auto justify-start bg-transparent p-0 border-b rounded-none h-auto gap-0">
            {(["overview", "activities", "escalations", "conversations"] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm"
              >
                {tab === "overview" && "Visão Geral"}
                {tab === "activities" && "Atividades"}
                {tab === "escalations" && "Escalações"}
                {tab === "conversations" && (
                  <span className="flex items-center gap-1.5">
                    Conversas
                    {conversations.length > 0 && (
                      <span className="bg-primary text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                        {conversations.length}
                      </span>
                    )}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            {/* Overview Tab */}
            <TabsContent value="overview" className="m-0 p-6 space-y-6">
              {/* Contact Info */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Informações de Contato
                </h3>
                <div className="space-y-2.5">
                  <InfoRow icon={Phone} label="Telefone" value={formatPhone(lead.phoneNumber)} />
                  <InfoRow icon={Mail} label="Email" value={lead.email ?? "—"} />
                  <InfoRow icon={User} label="Nome" value={lead.profileName ?? "—"} />
                </div>
              </div>

              <Separator />

              {/* Business Info */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Informações do Negócio
                </h3>
                <div className="space-y-2.5">
                  <InfoRow icon={Tag} label="Status" value={statusLabel(lead.status)} />
                  <InfoRow icon={ChevronRight} label="Fonte" value={lead.leadOrigin === "INBOUND" ? "Entrada" : "Saída"} />
                  <InfoRow
                    icon={Clock}
                    label="Último Contato"
                    value={lead.lastActivityAt ? formatDateTime(lead.lastActivityAt) : "—"}
                  />
                  <InfoRow
                    icon={Calendar}
                    label="Criado em"
                    value={formatDate(lead.createdAt)}
                  />
                  <InfoRow icon={MapPin} label="Localização" value={lead.location ?? "—"} />
                </div>
              </div>

              {/* Tags */}
              {lead.tags && lead.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Tags
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {lead.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2.5 py-1 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Activities Tab */}
            <TabsContent value="activities" className="m-0 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Histórico de Atividades</h3>
                <Button size="sm" variant="outline">+ Adicionar</Button>
              </div>
              {lead.activities && lead.activities.length > 0 ? (
                <div className="space-y-3">
                  {lead.activities.map((activity) => (
                    <div key={activity.id} className="flex gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Tag className="w-3 h-3" />
                      </div>
                      <div>
                        <p className="font-medium">{activity.type}</p>
                        <p className="text-muted-foreground text-xs">{activity.description}</p>
                        <p className="text-muted-foreground text-xs mt-0.5">
                          {relativeTime(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground text-sm py-8">
                  Nenhuma atividade registrada
                </p>
              )}
            </TabsContent>

            {/* Escalations Tab */}
            <TabsContent value="escalations" className="m-0 p-6">
              <h3 className="text-sm font-semibold mb-4">Escalações para Vendedor</h3>
              {lead.escalations && lead.escalations.length > 0 ? (
                <div className="space-y-3">
                  {lead.escalations.map((esc) => (
                    <div key={esc.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant={esc.status === "RESOLVED" ? "success" : "warning"}>
                          {esc.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {relativeTime(esc.createdAt)}
                        </span>
                      </div>
                      {esc.reason && (
                        <p className="text-sm text-muted-foreground mt-2">{esc.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground text-sm py-8">
                  Nenhuma escalação
                </p>
              )}
            </TabsContent>

            {/* Conversations Tab */}
            <TabsContent value="conversations" className="m-0 p-6">
              <h3 className="text-sm font-semibold mb-4">Conversas WhatsApp</h3>

              {convsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center">
                    <Bot className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">Nenhuma conversa encontrada</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {conversations.map((conv) => {
                    const name = conv.profileName ?? lead.profileName ?? lead.phoneNumber ?? "Desconhecido";
                    return (
                      <div
                        key={conv.id}
                        className="border rounded-lg p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => {
                          if (onOpenChat) {
                            onOpenChat(conv.whatsappProviderConfigId);
                            onClose();
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm truncate">{name}</p>
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0",
                                  conv.isActive ? "bg-green-500" : "bg-gray-300"
                                )}
                              />
                            </div>
                            {conv.provider && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                📱 {conv.provider.accountName} · {conv.provider.displayPhoneNumber}
                              </p>
                            )}
                            {conv.lastMessage && (
                              <p className="text-xs text-muted-foreground truncate mt-1">
                                {conv.lastMessage.role === "ASSISTANT" ? "Você: " : ""}
                                {conv.lastMessage.content}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {conv.lastMessageAt && (
                              <p className="text-xs text-muted-foreground">
                                {relativeTime(conv.lastMessageAt)}
                              </p>
                            )}
                            <Badge
                              variant={conv.isActive ? "success" : "muted"}
                              className="mt-1 text-[10px] px-1.5 py-0"
                            >
                              {conv.isActive ? "Ativo" : "Encerrado"}
                            </Badge>
                          </div>
                        </div>

                        {conv.tags && conv.tags.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {conv.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white"
                                style={{ backgroundColor: tag.color }}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    OPEN: "Aberto",
    ESCALATED: "Escalado",
    CLOSED: "Encerrado",
    BLOCKED: "Bloqueado",
  };
  return labels[status] ?? status;
}
