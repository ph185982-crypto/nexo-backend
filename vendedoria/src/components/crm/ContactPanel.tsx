"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X, Plus, Trash2, Loader2, Save, MapPin, Clock,
  CreditCard, User, Package, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Lead { id: string; profileName: string | null; phoneNumber: string; status: string }
interface Conv {
  id: string; etapa: string; produtoInteresse: string | null;
  localizacaoTexto: string | null; nomeRecebedor: string | null;
  horarioEntrega: string | null; formaPagamento: string | null;
  lead: Lead | null;
}
interface LeadNote { id: string; content: string; createdAt: string }
interface LeadTag  { tagId: string; tag: { id: string; name: string; color: string } }

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  return local || raw;
}

const ETAPA_MAP: Record<string, { label: string; color: string }> = {
  NOVO:               { label: "Novo",            color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  PRODUTO_IDENTIFICADO:{ label: "Qualificando",   color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  NEGOCIANDO:         { label: "Negociando",      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  COLETANDO_DADOS:    { label: "Coletando dados", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  PEDIDO_CONFIRMADO:  { label: "Confirmado",      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  PERDIDO:            { label: "Perdido",         color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export function ContactPanel({ conv, onClose }: { conv: Conv; onClose: () => void }) {
  const leadId = conv.lead?.id;
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [addingTag, setAddingTag] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    const [nr, tr] = await Promise.all([
      fetch(`/api/leads/${leadId}/notes`).then(r => r.json()),
      fetch(`/api/leads/${leadId}/tags`).then(r => r.json()),
    ]);
    setNotes(nr as LeadNote[]);
    setTags(tr as LeadTag[]);
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  const saveNote = useCallback(async () => {
    if (!leadId || !noteInput.trim()) return;
    setSavingNote(true);
    await fetch(`/api/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: noteInput }),
    });
    setNoteInput("");
    await load();
    setSavingNote(false);
  }, [leadId, noteInput, load]);

  const addTag = useCallback(async () => {
    if (!leadId || !tagInput.trim()) return;
    setAddingTag(true);
    await fetch(`/api/leads/${leadId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tagInput.trim() }),
    });
    setTagInput("");
    await load();
    setAddingTag(false);
  }, [leadId, tagInput, load]);

  const removeTag = useCallback(async (tagId: string) => {
    if (!leadId) return;
    await fetch(`/api/leads/${leadId}/tags/${tagId}`, { method: "DELETE" });
    await load();
  }, [leadId, load]);

  const lead = conv.lead;
  const etapa = ETAPA_MAP[conv.etapa] ?? { label: conv.etapa, color: "bg-muted text-muted-foreground" };

  const initial = (lead?.profileName ?? lead?.phoneNumber ?? "?")[0]?.toUpperCase();
  const avatarHue = lead?.profileName
    ? (lead.profileName.charCodeAt(0) * 37) % 360
    : 220;

  return (
    <div className="flex flex-col h-full bg-card border-l border-border w-full md:w-[280px] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <h3 className="font-semibold text-sm">Painel do Lead</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar + name */}
        <div className="px-4 py-5 text-center border-b border-border">
          <div
            className="w-14 h-14 rounded-full text-xl font-bold flex items-center justify-center mx-auto mb-3 text-white shadow-md"
            style={{ background: `hsl(${avatarHue}, 65%, 45%)` }}
          >
            {initial}
          </div>
          <p className="font-semibold text-foreground text-sm">
            {lead?.profileName ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lead ? formatPhone(lead.phoneNumber) : "—"}
          </p>
          {/* Stage badge */}
          <span className={cn("inline-flex items-center mt-2 px-2.5 py-1 rounded-full text-xs font-semibold", etapa.color)}>
            {etapa.label}
          </span>
        </div>

        {/* Info fields */}
        <div className="px-4 py-3 space-y-2.5 border-b border-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Detalhes</p>
          <InfoRow icon={Package}    label="Produto"   value={conv.produtoInteresse?.replace("_", " ")} />
          <InfoRow icon={MapPin}     label="Endereço"  value={conv.localizacaoTexto} />
          <InfoRow icon={Clock}      label="Horário"   value={conv.horarioEntrega} />
          <InfoRow icon={CreditCard} label="Pagamento" value={conv.formaPagamento} />
          <InfoRow icon={User}       label="Recebedor" value={conv.nomeRecebedor} />
        </div>

        {/* Notes */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notas Internas</p>
          <div className="space-y-2 mb-3">
            {notes.map(n => (
              <div key={n.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-700/30 rounded-lg px-3 py-2 text-xs">
                <p className="text-foreground whitespace-pre-wrap">{n.content}</p>
                <p className="text-muted-foreground mt-1">
                  {new Date(n.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            ))}
            {notes.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma nota ainda</p>
            )}
          </div>
          <Textarea
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            placeholder="Adicionar nota..."
            rows={2}
            className="text-xs resize-none mb-2"
          />
          <Button
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={() => void saveNote()}
            disabled={savingNote || !noteInput.trim()}
          >
            {savingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Salvar nota
          </Button>
        </div>

        {/* Tags */}
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map(t => (
              <span
                key={t.tagId}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: t.tag.color + "22", color: t.tag.color }}
              >
                {t.tag.name}
                <button
                  onClick={() => void removeTag(t.tagId)}
                  className="opacity-70 hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma tag</p>
            )}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              placeholder="Nova tag..."
              className="flex-1 h-8 text-xs"
              onKeyDown={e => { if (e.key === "Enter") void addTag(); }}
            />
            <Button
              size="icon"
              className="h-8 w-8"
              onClick={() => void addTag()}
              disabled={addingTag || !tagInput.trim()}
            >
              {addingTag ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-muted-foreground">{label}: </span>
        <span className={cn("text-foreground", !value && "text-muted-foreground italic")}>
          {value ?? "não coletado"}
        </span>
      </div>
    </div>
  );
}
