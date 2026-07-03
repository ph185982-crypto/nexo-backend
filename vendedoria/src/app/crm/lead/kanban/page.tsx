"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Search, SlidersHorizontal, Phone, MoreVertical, ChevronDown, Loader2, Plus,
} from "lucide-react";
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, getAvatarColor, formatPhone } from "@/lib/utils";
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

const CREATE_LEAD = gql`
  mutation CreateLeadKanban($input: CreateLeadInput!) {
    createLead(input: $input) {
      id
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
  columns,
  onClick,
  onMove,
  dragging,
}: {
  lead: Lead;
  columns: Column[];
  onClick: () => void;
  onMove: (leadId: string, columnId: string) => void;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  const initials = getInitials(lead.profileName ?? lead.phoneNumber);
  const avatarColor = getAvatarColor(lead.profileName);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`kanban-card cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""} ${dragging ? "shadow-xl rotate-2" : ""}`}
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
              onPointerDown={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onClick}>Ver detalhes</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Mover para</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {columns.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      disabled={col.type === lead.kanbanColumn?.type}
                      onClick={() => onMove(lead.id, col.id)}
                    >
                      <span
                        className="w-2 h-2 rounded-full mr-2"
                        style={{ backgroundColor: col.color }}
                      />
                      {col.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
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

function KanbanColumn({
  column,
  columns,
  onLeadClick,
  onMove,
}: {
  column: Column;
  columns: Column[];
  onLeadClick: (lead: Lead) => void;
  onMove: (leadId: string, columnId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className={`kanban-column flex-shrink-0 ${isOver ? "ring-2 ring-primary/60 rounded-lg" : ""}`}>
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
        <div ref={setNodeRef} className="p-2 space-y-2 min-h-[120px]">
          {column.leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              columns={columns}
              onClick={() => onLeadClick(lead)}
              onMove={onMove}
            />
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
  const [novaOpen, setNovaOpen] = useState(false);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [filters, setFilters] = useState<{
    leadStatus?: string;
    leadOrigin?: string;
    periodDays?: number;
  }>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string; status: string }> =
    orgsData?.whatsappBusinessOrganizations ?? [];

  // Auto-seleciona a única org ativa (a Nexo)
  useEffect(() => {
    if (!selectedOrgId && orgs.length > 0) {
      const ativa = orgs.find((o) => o.status === "ACTIVE") ?? orgs[0];
      setSelectedOrgId(ativa.id);
    }
  }, [orgs, selectedOrgId]);

  const orgId = selectedOrgId || (orgs.find((o) => o.status === "ACTIVE")?.id ?? orgs[0]?.id ?? "");

  const { data, loading, refetch } = useQuery(GET_KANBAN, {
    variables: {
      organizationId: orgId,
      leadsPerColumn: 20,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    skip: !orgId,
    fetchPolicy: "cache-and-network",
  });

  const [moveLead] = useMutation(MOVE_LEAD, {
    onCompleted: () => void refetch(),
    onError: (e) => { console.error("[Kanban] moveLead:", e); void refetch(); },
  });

  const columns: Column[] = data?.getKanbanBoard?.columns ?? [];

  const handleMove = (leadId: string, columnId: string) => {
    void moveLead({ variables: { leadId, columnId } });
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveLead((e.active.data.current as { lead: Lead } | undefined)?.lead ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveLead(null);
    const leadId = String(e.active.id);
    const columnId = e.over ? String(e.over.id) : null;
    if (!columnId) return;
    const origem = columns.find((c) => c.leads.some((l) => l.id === leadId));
    if (origem?.id === columnId) return;
    handleMove(leadId, columnId);
  };

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
      <div className="px-6 py-4 bg-card border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">CRM — Funil de Vendas</h1>

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
            <Button size="sm" onClick={() => setNovaOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Nova oportunidade
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
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex gap-4 p-6 h-full min-w-max">
              {filteredColumns.map((col) => (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  columns={columns}
                  onLeadClick={setSelectedLead}
                  onMove={handleMove}
                />
              ))}
              {filteredColumns.length === 0 && (
                <div className="flex items-center justify-center w-full text-muted-foreground">
                  <p>Nenhuma coluna — rode o seed da Nexo</p>
                </div>
              )}
            </div>
          </div>
          <DragOverlay>
            {activeLead && (
              <LeadCard
                lead={activeLead}
                columns={columns}
                onClick={() => {}}
                onMove={() => {}}
                dragging
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Lead Detail Modal */}
      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />

      {/* Nova Oportunidade */}
      <NovaOportunidadeDialog
        open={novaOpen}
        onClose={() => setNovaOpen(false)}
        organizationId={orgId}
        columns={columns}
        onCreated={() => { setNovaOpen(false); void refetch(); }}
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

function NovaOportunidadeDialog({
  open,
  onClose,
  organizationId,
  columns,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  columns: Column[];
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [colunaId, setColunaId] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const [createLead, { loading }] = useMutation(CREATE_LEAD, {
    onCompleted: () => {
      setNome(""); setTelefone(""); setColunaId(""); setErro(null);
      onCreated();
    },
    onError: (e) => setErro(e.message),
  });

  const salvar = () => {
    const tel = telefone.replace(/\D/g, "");
    if (!tel || tel.length < 10) {
      setErro("Informe um telefone válido com DDD.");
      return;
    }
    const kanbanColumnId = colunaId || columns[0]?.id;
    if (!kanbanColumnId) {
      setErro("Nenhuma coluna disponível.");
      return;
    }
    void createLead({
      variables: {
        input: {
          phoneNumber: tel.startsWith("55") ? tel : `55${tel}`,
          profileName: nome.trim() || undefined,
          leadOrigin: "OUTBOUND",
          organizationId,
          kanbanColumnId,
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova oportunidade</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome / Empresa</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Loja Exemplo" />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp (com DDD)</Label>
            <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="62 99999-9999" />
          </div>
          <div className="space-y-2">
            <Label>Etapa inicial</Label>
            <Select value={colunaId || columns[0]?.id} onValueChange={setColunaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={salvar} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Criar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
