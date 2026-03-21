"use client";

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Search, SlidersHorizontal, Phone, MoreVertical, ChevronDown, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials, getAvatarColor, formatPhone } from "@/lib/utils";
import { LeadDetailModal } from "@/components/crm/LeadDetailModal";
import { Label } from "@/components/ui/label";

const GET_KANBAN = gql`
  query GetKanban($organizationId: String!, $leadsPerColumn: Int, $filters: KanbanFilter) {
    getKanbanBoard(organizationId: $organizationId, leadsPerColumn: $leadsPerColumn, filters: $filters) {
      columns {
        id name order type color isDefaultEntry totalLeadsCount hasMoreLeads nextCursor
        leads {
          id phoneNumber profileName leadOrigin status createdAt lastActivityAt
          kanbanColumn { name color type }
          tags { id name color kind }
        }
      }
    }
  }
`;

const MOVE_LEAD = gql`
  mutation MoveLead($leadId: String!, $columnId: String!) {
    updateLeadKanbanColumn(leadId: $leadId, columnId: $columnId) {
      id kanbanColumnId
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsKanban {
    whatsappBusinessOrganizations { id name status }
  }
`;

interface Lead {
  id: string;
  phoneNumber: string;
  profileName?: string;
  leadOrigin: string;
  status: string;
  createdAt: string;
  lastActivityAt?: string;
  kanbanColumn?: { name: string; color: string; type: string };
  tags?: Array<{ id: string; name: string; color: string; kind: string }>;
}

interface Column {
  id: string;
  name: string;
  type: string;
  color: string;
  totalLeadsCount: number;
  hasMoreLeads: boolean;
  nextCursor?: string;
  leads: Lead[];
}

function LeadCard({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: () => void;
}) {
  const initials = getInitials(lead.profileName ?? lead.phoneNumber);
  const avatarColor = getAvatarColor(lead.profileName);

  return (
    <div
      className="kanban-card"
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarFallback
            className="text-white text-xs font-semibold"
            style={{ backgroundColor: avatarColor }}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {lead.profileName ?? "Sem nome"}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" />
            {formatPhone(lead.phoneNumber)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Ver detalhes</DropdownMenuItem>
            <DropdownMenuItem>Mover coluna</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">Encerrar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        <Badge
          variant={lead.leadOrigin === "INBOUND" ? "success" : "info"}
          className="text-xs px-1.5 py-0"
        >
          {lead.leadOrigin === "INBOUND" ? "Entrada" : "Saída"}
        </Badge>
        {lead.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({ column, onLeadClick }: { column: Column; onLeadClick: (lead: Lead) => void }) {
  return (
    <div className="kanban-column flex-shrink-0">
      {/* Column Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-t-lg text-white"
        style={{ backgroundColor: column.color }}
      >
        <span className="font-semibold text-sm">{column.name}</span>
        <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          {column.totalLeadsCount}
        </span>
      </div>

      {/* Leads */}
      <ScrollArea className="flex-1 max-h-[calc(100vh-280px)]">
        <div className="p-2 space-y-2">
          {column.leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
          ))}

          {column.leads.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-xs text-muted-foreground">Nenhum lead</p>
            </div>
          )}

          {column.hasMoreLeads && (
            <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1">
              <ChevronDown className="w-3 h-3" />
              Ver mais
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function KanbanPage() {
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<{
    leadStatus?: string;
    leadOrigin?: string;
    periodDays?: number;
  }>({});

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = orgsData?.whatsappBusinessOrganizations ?? [];

  const { data, loading } = useQuery(GET_KANBAN, {
    variables: {
      organizationId: selectedOrgId || (orgs[0]?.id ?? ""),
      leadsPerColumn: 20,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    skip: !selectedOrgId && orgs.length === 0,
    fetchPolicy: "cache-and-network",
  });

  const columns: Column[] = data?.getKanbanBoard?.columns ?? [];

  // Filter by search
  const filteredColumns = columns.map((col) => ({
    ...col,
    leads: col.leads.filter((lead) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        lead.profileName?.toLowerCase().includes(q) ||
        lead.phoneNumber.includes(q)
      );
    }),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Select
              value={selectedOrgId}
              onValueChange={setSelectedOrgId}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Selecionar organização" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((org: { id: string; name: string }) => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <h1 className="text-xl font-semibold">Kanban de Leads</h1>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal className="w-4 h-4 mr-1.5" />
              Filtros
            </Button>
          </div>
        </div>
      </div>

      {/* Board */}
      {loading && columns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 p-6 h-full min-w-max">
            {filteredColumns.map((col) => (
              <KanbanColumn
                key={col.id}
                column={col}
                onLeadClick={setSelectedLead}
              />
            ))}
            {filteredColumns.length === 0 && (
              <div className="flex items-center justify-center w-full text-muted-foreground">
                <p>Selecione uma organização para ver o kanban</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lead Detail Modal */}
      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />

      {/* Filter Modal */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Filtros</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status do Lead</Label>
              <Select
                value={filters.leadStatus ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, leadStatus: v === "all" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="OPEN">Aberto</SelectItem>
                  <SelectItem value="ESCALATED">Escalado</SelectItem>
                  <SelectItem value="CLOSED">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Origem</Label>
              <Select
                value={filters.leadOrigin ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, leadOrigin: v === "all" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="INBOUND">Entrada</SelectItem>
                  <SelectItem value="OUTBOUND">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Período</Label>
              <Select
                value={String(filters.periodDays ?? "all")}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, periodDays: v === "all" ? undefined : Number(v) }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tudo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tudo</SelectItem>
                  <SelectItem value="1">Hoje</SelectItem>
                  <SelectItem value="7">7 dias</SelectItem>
                  <SelectItem value="30">30 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setFilters({}); setFilterOpen(false); }}
              >
                Limpar
              </Button>
              <Button className="flex-1" onClick={() => setFilterOpen(false)}>
                Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
