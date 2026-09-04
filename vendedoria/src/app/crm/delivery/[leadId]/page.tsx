"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronDown, ChevronRight, Lock, Loader2, Plus, Trash2,
  Save, CheckCircle2, GripVertical, X, Pencil,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatPhone } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DiagnosisBlock = "comercialData" | "produtoData" | "marketingData" | "operacaoData" | "financeiroData";

type PriorizacaoItem = {
  pilar: string;
  acao: string;
  dataAlvo: string;
  responsavel: string;
};

type Diagnosis = {
  id: string;
  leadId: string;
  comercialData: Record<string, string>;
  produtoData: Record<string, string>;
  marketingData: Record<string, string>;
  operacaoData: Record<string, string>;
  financeiroData: Record<string, string>;
  priorizacaoData: PriorizacaoItem[];
  isFinalized: boolean;
  finalizedAt: string | null;
  cards: DeliveryCard[];
};

type DeliveryCard = {
  id: string;
  diagnosisId: string;
  title: string;
  description?: string;
  pilar: string;
  dataAlvo?: string;
  responsavel: string;
  column: string;
  order: number;
};

type Lead = {
  id: string;
  phoneNumber: string;
  profileName?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PILAR_OPTIONS = [
  { value: "COMERCIAL", label: "Comercial" },
  { value: "PRODUTO", label: "Produto e Oferta" },
  { value: "MARKETING", label: "Marketing e Canais" },
  { value: "OPERACAO", label: "Operação" },
  { value: "FINANCEIRO", label: "Financeiro" },
  { value: "TECNOLOGIA", label: "Tecnologia" },
];

const RESPONSAVEL_OPTIONS = [
  { value: "PEDRO", label: "Pedro" },
  { value: "LAYANE", label: "Layane" },
  { value: "CLIENTE", label: "Cliente" },
];

const KANBAN_COLUMNS = [
  { id: "DIAGNOSTICO", label: "Diagnóstico" },
  { id: "BACKLOG", label: "Backlog do Plano" },
  { id: "ESSA_SEMANA", label: "Essa Semana" },
  { id: "EM_ANDAMENTO", label: "Em Andamento" },
  { id: "AGUARDANDO_CLIENTE", label: "Aguardando Cliente" },
  { id: "CONCLUIDO", label: "Concluído" },
];

const PILAR_COLORS: Record<string, string> = {
  COMERCIAL: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  PRODUTO: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  MARKETING: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  OPERACAO: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  FINANCEIRO: "bg-green-500/10 text-green-400 border-green-500/20",
  TECNOLOGIA: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

const BLOCK_DEFS: Array<{
  key: DiagnosisBlock;
  label: string;
  icon: string;
  fields: Array<{ key: string; label: string; multiline?: boolean }>;
}> = [
  {
    key: "comercialData",
    label: "Comercial",
    icon: "💼",
    fields: [
      { key: "ticketMedio", label: "Ticket médio atual" },
      { key: "cicloVenda", label: "Ciclo de venda" },
      { key: "numVendedores", label: "Nº de vendedores" },
      { key: "metaMensal", label: "Meta de faturamento mensal" },
      { key: "principalObjeco", label: "Principal objeção de compra" },
      { key: "observacoes", label: "Observações", multiline: true },
    ],
  },
  {
    key: "produtoData",
    label: "Produto e Oferta",
    icon: "🛍️",
    fields: [
      { key: "produtoPrincipal", label: "Produto / serviço principal" },
      { key: "categorias", label: "Categorias vendidas" },
      { key: "diferencial", label: "Diferencial competitivo" },
      { key: "precificacao", label: "Estratégia de precificação" },
      { key: "margemEstimada", label: "Margem estimada (%)" },
      { key: "observacoes", label: "Observações", multiline: true },
    ],
  },
  {
    key: "marketingData",
    label: "Marketing e Canais",
    icon: "📣",
    fields: [
      { key: "canaisAtivos", label: "Canais ativos (Shopee, ML, Insta...)" },
      { key: "presencaDigital", label: "Situação da presença digital" },
      { key: "investimentoAds", label: "Investimento mensal em ads" },
      { key: "nivelConteudo", label: "Nível de conteúdo (nenhum/pouco/moderado/intenso)" },
      { key: "observacoes", label: "Observações", multiline: true },
    ],
  },
  {
    key: "operacaoData",
    label: "Operação",
    icon: "⚙️",
    fields: [
      { key: "equipeAtual", label: "Equipe atual" },
      { key: "ferramentas", label: "Ferramentas utilizadas" },
      { key: "gargaloOperacional", label: "Principal gargalo operacional" },
      { key: "logistica", label: "Logística / entrega" },
      { key: "observacoes", label: "Observações", multiline: true },
    ],
  },
  {
    key: "financeiroData",
    label: "Financeiro",
    icon: "💰",
    fields: [
      { key: "faturamentoMensal", label: "Faturamento mensal atual" },
      { key: "custoFixo", label: "Custos fixos estimados" },
      { key: "capacidadeInvestimento", label: "Capacidade de investimento mensal" },
      { key: "acessoCredito", label: "Tem acesso a crédito? (Sim/Não)" },
      { key: "observacoes", label: "Observações", multiline: true },
    ],
  },
];

// ─── Draggable Card ───────────────────────────────────────────────────────────

function DraggableCard({
  card,
  onEdit,
  onDelete,
  isDragOverlay,
}: {
  card: DeliveryCard;
  onEdit: (card: DeliveryCard) => void;
  onDelete: (id: string) => void;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: card,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-border bg-card p-3 group cursor-grab active:cursor-grabbing",
        isDragging && !isDragOverlay && "opacity-30",
        isDragOverlay && "shadow-lg rotate-1",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <GripVertical className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight mb-1.5">{card.title}</p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className={cn("text-xs py-0", PILAR_COLORS[card.pilar] ?? "")}>
              {PILAR_OPTIONS.find((p) => p.value === card.pilar)?.label ?? card.pilar}
            </Badge>
            <Badge variant="outline" className="text-xs py-0 text-muted-foreground">
              {RESPONSAVEL_OPTIONS.find((r) => r.value === card.responsavel)?.label ?? card.responsavel}
            </Badge>
          </div>
          {card.dataAlvo && (
            <p className="text-xs text-muted-foreground mt-1">
              Meta: {new Date(card.dataAlvo).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
        {/* action buttons — only shown when not dragging */}
        {!isDragOverlay && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(card);
              }}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(card.id);
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Droppable Column ─────────────────────────────────────────────────────────

function DroppableColumn({
  col,
  cards,
  onEdit,
  onDelete,
  onAddCard,
  activeCard,
}: {
  col: { id: string; label: string };
  cards: DeliveryCard[];
  onEdit: (card: DeliveryCard) => void;
  onDelete: (id: string) => void;
  onAddCard: (column: string) => void;
  activeCard: DeliveryCard | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  return (
    <div className="flex flex-col min-w-[200px] w-[220px] flex-shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
          {col.label}
        </span>
        <Badge variant="secondary" className="text-xs py-0 ml-1 flex-shrink-0">
          {cards.length}
        </Badge>
      </div>
      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-2 rounded-xl p-2 min-h-[120px] transition-colors",
          "bg-muted/30 border border-dashed border-transparent",
          isOver && "bg-primary/5 border-primary/30",
        )}
      >
        {cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        {/* Placeholder when dragging over empty column */}
        {isOver && activeCard && cards.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-primary/40 h-16 flex items-center justify-center">
            <p className="text-xs text-primary/60">Soltar aqui</p>
          </div>
        )}
      </div>
      {/* Add card button */}
      <button
        onClick={() => onAddCard(col.id)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-1"
      >
        <Plus className="w-3 h-3" />
        Adicionar card
      </button>
    </div>
  );
}

// ─── Card Edit Dialog ─────────────────────────────────────────────────────────

function CardDialog({
  open,
  card,
  defaultColumn,
  onClose,
  onSave,
}: {
  open: boolean;
  card: Partial<DeliveryCard> | null;
  defaultColumn?: string;
  onClose: () => void;
  onSave: (data: Partial<DeliveryCard>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pilar, setPilar] = useState("COMERCIAL");
  const [responsavel, setResponsavel] = useState("PEDRO");
  const [dataAlvo, setDataAlvo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(card?.title ?? "");
      setDescription(card?.description ?? "");
      setPilar(card?.pilar ?? "COMERCIAL");
      setResponsavel(card?.responsavel ?? "PEDRO");
      setDataAlvo(
        card?.dataAlvo ? new Date(card.dataAlvo).toISOString().slice(0, 10) : "",
      );
    }
  }, [open, card]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        pilar,
        responsavel,
        dataAlvo: dataAlvo || undefined,
        column: card?.column ?? defaultColumn ?? "BACKLOG",
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{card?.id ? "Editar card" : "Novo card"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-title">Título *</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Descreva a ação..."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-desc">Descrição (opcional)</Label>
            <Textarea
              id="card-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Detalhes adicionais..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Pilar</Label>
              <Select value={pilar} onValueChange={setPilar}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PILAR_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Responsável</Label>
              <Select value={responsavel} onValueChange={setResponsavel}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSAVEL_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} className="text-xs">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-data">Data alvo</Label>
            <Input
              id="card-data"
              type="date"
              value={dataAlvo}
              onChange={(e) => setDataAlvo(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diagnosis Block ──────────────────────────────────────────────────────────

function DiagnosisBlock({
  blockDef,
  value,
  onChange,
  readOnly,
}: {
  blockDef: (typeof BLOCK_DEFS)[number];
  value: Record<string, string>;
  onChange: (key: string, val: string) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filled = Object.values(value).some((v) => v.trim() !== "");

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-lg">{blockDef.icon}</span>
        <span className="flex-1 font-medium text-sm">{blockDef.label}</span>
        {filled && (
          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
        )}
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 bg-card border-t border-border flex flex-col gap-3">
          {blockDef.fields.map((field) =>
            field.multiline ? (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">{field.label}</Label>
                <Textarea
                  value={value[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  disabled={readOnly}
                  rows={3}
                  placeholder={readOnly ? "—" : "Digite..."}
                />
              </div>
            ) : (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">{field.label}</Label>
                <Input
                  value={value[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  disabled={readOnly}
                  placeholder={readOnly ? "—" : "Digite..."}
                />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Priorização Block ────────────────────────────────────────────────────────

function PriorizacaoBlock({
  items,
  onChange,
  readOnly,
}: {
  items: PriorizacaoItem[];
  onChange: (items: PriorizacaoItem[]) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);

  const addItem = () => {
    onChange([...items, { pilar: "COMERCIAL", acao: "", dataAlvo: "", responsavel: "PEDRO" }]);
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  const updateItem = (i: number, key: keyof PriorizacaoItem, val: string) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, [key]: val } : item)));
  };

  return (
    <div className="rounded-xl border border-2 border-primary/30 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-lg">🎯</span>
        <div className="flex-1">
          <span className="font-medium text-sm">Priorização</span>
          <p className="text-xs text-muted-foreground">
            Define os cards do Backlog automaticamente
          </p>
        </div>
        {items.length > 0 && (
          <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        )}
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 bg-card border-t border-border flex flex-col gap-4">
          {items.map((item, i) => (
            <div key={i} className="rounded-lg border border-border p-3 flex flex-col gap-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Prioridade {i + 1}</span>
                {!readOnly && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-destructive"
                    onClick={() => removeItem(i)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <Input
                placeholder="Descrição da ação..."
                value={item.acao}
                onChange={(e) => updateItem(i, "acao", e.target.value)}
                disabled={readOnly}
                className="text-sm"
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Pilar</Label>
                  <Select
                    value={item.pilar}
                    onValueChange={(v) => updateItem(i, "pilar", v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PILAR_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value} className="text-xs">
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Responsável</Label>
                  <Select
                    value={item.responsavel}
                    onValueChange={(v) => updateItem(i, "responsavel", v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESPONSAVEL_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value} className="text-xs">
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Data alvo</Label>
                  <Input
                    type="date"
                    value={item.dataAlvo}
                    onChange={(e) => updateItem(i, "dataAlvo", e.target.value)}
                    disabled={readOnly}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          ))}
          {!readOnly && items.length < 5 && (
            <Button variant="outline" size="sm" onClick={addItem} className="w-full">
              <Plus className="w-4 h-4 mr-1" />
              Adicionar prioridade
            </Button>
          )}
          {readOnly && items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Nenhuma prioridade definida
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = use(params);
  const router = useRouter();

  const [lead, setLead] = useState<Lead | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Form state (per block)
  const [blockData, setBlockData] = useState<Record<DiagnosisBlock, Record<string, string>>>({
    comercialData: {},
    produtoData: {},
    marketingData: {},
    operacaoData: {},
    financeiroData: {},
  });
  const [priorizacaoData, setPriorizacaoData] = useState<PriorizacaoItem[]>([]);

  // Kanban state
  const [cards, setCards] = useState<DeliveryCard[]>([]);
  const [activeCard, setActiveCard] = useState<DeliveryCard | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Partial<DeliveryCard> | null>(null);
  const [defaultCardColumn, setDefaultCardColumn] = useState("BACKLOG");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // ── Load lead + diagnosis ────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch lead info
      const leadRes = await fetch(`/api/delivery/${leadId}/lead-info`);
      if (leadRes.ok) setLead(await leadRes.json());

      // Fetch or create diagnosis
      let diagRes = await fetch(`/api/delivery/${leadId}/diagnosis`);
      let diagJson = await diagRes.json();
      if (!diagJson.diagnosis) {
        diagRes = await fetch(`/api/delivery/${leadId}/diagnosis`, { method: "POST" });
        diagJson = await diagRes.json();
      }
      const d: Diagnosis = diagJson.diagnosis;
      if (!d) { setLoading(false); return; }

      setDiagnosis(d);
      setBlockData({
        comercialData: (d.comercialData ?? {}) as Record<string, string>,
        produtoData: (d.produtoData ?? {}) as Record<string, string>,
        marketingData: (d.marketingData ?? {}) as Record<string, string>,
        operacaoData: (d.operacaoData ?? {}) as Record<string, string>,
        financeiroData: (d.financeiroData ?? {}) as Record<string, string>,
      });
      setPriorizacaoData((d.priorizacaoData ?? []) as PriorizacaoItem[]);
      setCards(d.cards ?? []);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Save draft ───────────────────────────────────────────────────────────────

  const saveDraft = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/delivery/${leadId}/diagnosis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...blockData, priorizacaoData }),
      });
      const json = await res.json();
      if (json.diagnosis) {
        setDiagnosis(json.diagnosis);
        setCards(json.diagnosis.cards ?? []);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Finalize ─────────────────────────────────────────────────────────────────

  const finalize = async () => {
    if (!confirm("Finalizar o diagnóstico? Após isso ele não poderá ser editado.")) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/delivery/${leadId}/diagnosis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...blockData, priorizacaoData, finalize: true }),
      });
      const json = await res.json();
      if (json.diagnosis) {
        setDiagnosis(json.diagnosis);
        setCards(json.diagnosis.cards ?? []);
      }
    } finally {
      setFinalizing(false);
    }
  };

  // ── Block data change ────────────────────────────────────────────────────────

  const handleBlockChange = (block: DiagnosisBlock, key: string, val: string) => {
    setBlockData((prev) => ({ ...prev, [block]: { ...prev[block], [key]: val } }));
  };

  // ── Kanban drag ──────────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    setActiveCard(card ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cardId = active.id as string;
    const newColumn = over.id as string;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.column === newColumn) return;

    // Optimistic update
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column: newColumn } : c)),
    );

    await fetch(`/api/delivery/${leadId}/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: newColumn }),
    });
  };

  // ── Card CRUD ────────────────────────────────────────────────────────────────

  const openNewCard = (column: string) => {
    setEditingCard(null);
    setDefaultCardColumn(column);
    setCardDialogOpen(true);
  };

  const openEditCard = (card: DeliveryCard) => {
    setEditingCard(card);
    setDefaultCardColumn(card.column);
    setCardDialogOpen(true);
  };

  const handleCardSave = async (data: Partial<DeliveryCard>) => {
    if (editingCard?.id) {
      // Update
      const res = await fetch(`/api/delivery/${leadId}/cards/${editingCard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      setCards((prev) =>
        prev.map((c) => (c.id === editingCard.id ? json.card : c)),
      );
    } else {
      // Create
      const res = await fetch(`/api/delivery/${leadId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, column: defaultCardColumn }),
      });
      const json = await res.json();
      setCards((prev) => [...prev, json.card]);
    }
  };

  const handleCardDelete = async (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    await fetch(`/api/delivery/${leadId}/cards/${cardId}`, { method: "DELETE" });
  };

  const readOnly = diagnosis?.isFinalized ?? false;

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => router.push("/crm/delivery")}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Trophy className="w-4 h-4 text-yellow-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">
            {lead?.profileName || formatPhone(lead?.phoneNumber ?? leadId)}
          </p>
          {lead?.profileName && (
            <p className="text-xs text-muted-foreground">{formatPhone(lead.phoneNumber)}</p>
          )}
        </div>
        {readOnly ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
            <Lock className="w-3 h-3" />
            Diagnóstico finalizado
          </Badge>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={saveDraft}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  Salvar rascunho
                </>
              )}
            </Button>
            <Button
              size="sm"
              onClick={finalize}
              disabled={finalizing}
            >
              {finalizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Finalizar
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="diagnostico" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-2 self-start flex-shrink-0">
          <TabsTrigger value="diagnostico">
            📋 Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="quadro">
            🗂️ Quadro de Entregas
          </TabsTrigger>
        </TabsList>

        {/* ── Diagnóstico tab ─────────────────────────────────────────────────── */}
        <TabsContent value="diagnostico" className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            {readOnly && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm border border-green-500/20">
                <Lock className="w-4 h-4 flex-shrink-0" />
                Diagnóstico finalizado em{" "}
                {diagnosis?.finalizedAt
                  ? new Date(diagnosis.finalizedAt).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })
                  : "—"}
              </div>
            )}

            {BLOCK_DEFS.map((def) => (
              <DiagnosisBlock
                key={def.key}
                blockDef={def}
                value={blockData[def.key]}
                onChange={(key, val) => handleBlockChange(def.key, key, val)}
                readOnly={readOnly}
              />
            ))}

            <PriorizacaoBlock
              items={priorizacaoData}
              onChange={setPriorizacaoData}
              readOnly={readOnly}
            />

            {!readOnly && (
              <div className="flex gap-2 justify-end pt-2 pb-6">
                <Button variant="outline" onClick={saveDraft} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                  Salvar rascunho
                </Button>
                <Button onClick={finalize} disabled={finalizing}>
                  {finalizing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  Finalizar e gerar cards
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Quadro tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="quadro" className="flex-1 overflow-hidden">
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 h-full overflow-x-auto p-4 pb-6">
              {KANBAN_COLUMNS.map((col) => (
                <DroppableColumn
                  key={col.id}
                  col={col}
                  cards={cards.filter((c) => c.column === col.id)}
                  onEdit={openEditCard}
                  onDelete={handleCardDelete}
                  onAddCard={openNewCard}
                  activeCard={activeCard}
                />
              ))}
            </div>
            <DragOverlay>
              {activeCard && (
                <DraggableCard
                  card={activeCard}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  isDragOverlay
                />
              )}
            </DragOverlay>
          </DndContext>
        </TabsContent>
      </Tabs>

      {/* Card edit dialog */}
      <CardDialog
        open={cardDialogOpen}
        card={editingCard}
        defaultColumn={defaultCardColumn}
        onClose={() => setCardDialogOpen(false)}
        onSave={handleCardSave}
      />
    </div>
  );
}
