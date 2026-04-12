"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2, Loader2, Save } from "lucide-react";
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
  const ETAPA: Record<string, string> = {
    NOVO: "Novo", PRODUTO_IDENTIFICADO: "Qualificando", NEGOCIANDO: "Negociando",
    COLETANDO_DADOS: "Coletando dados", PEDIDO_CONFIRMADO: "✅ Confirmado", PERDIDO: "❌ Perdido",
  };

  return (
    <div className="flex flex-col h-full bg-white border-l w-full md:w-[300px] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Perfil do contato</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar + name */}
        <div className="px-4 py-4 text-center border-b">
          <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 text-2xl font-bold flex items-center justify-center mx-auto mb-2">
            {(lead?.profileName ?? lead?.phoneNumber)?.[0]?.toUpperCase() ?? "?"}
          </div>
          <p className="font-semibold text-[var(--texto)]">{lead?.profileName ?? "—"}</p>
          <p className="text-sm text-[var(--texto-secundario)]">📱 {lead ? formatPhone(lead.phoneNumber) : "—"}</p>
        </div>

        {/* Info fields */}
        <div className="px-4 py-3 space-y-2 border-b">
          <InfoRow label="🔧 Produto" value={conv.produtoInteresse?.replace("_", " ") ?? null} />
          <InfoRow label="📍 Endereço" value={conv.localizacaoTexto} />
          <InfoRow label="⏰ Horário" value={conv.horarioEntrega} />
          <InfoRow label="💳 Pagamento" value={conv.formaPagamento} />
          <InfoRow label="🙍 Recebedor" value={conv.nomeRecebedor} />
          <InfoRow label="📊 Etapa" value={ETAPA[conv.etapa] ?? conv.etapa} />
        </div>

        {/* Notes */}
        <div className="px-4 py-3 border-b">
          <p className="text-xs font-semibold text-[var(--texto-secundario)] uppercase mb-2">Notas internas</p>
          <div className="space-y-2 mb-2">
            {notes.map(n => (
              <div key={n.id} className="bg-amber-50 rounded-lg px-3 py-2 text-xs">
                <p className="text-[var(--texto)] whitespace-pre-wrap">{n.content}</p>
                <p className="text-[var(--texto-terciario)] mt-0.5">{new Date(n.createdAt).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</p>
              </div>
            ))}
            {notes.length === 0 && <p className="text-xs text-[var(--texto-terciario)] italic">Nenhuma nota</p>}
          </div>
          <Textarea
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            placeholder="Adicionar nota..."
            rows={2}
            className="text-xs resize-none mb-1"
          />
          <Button size="sm" className="w-full text-xs gap-1 bg-[var(--primaria)]" onClick={() => void saveNote()} disabled={savingNote || !noteInput.trim()}>
            {savingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar nota
          </Button>
        </div>

        {/* Tags */}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-[var(--texto-secundario)] uppercase mb-2">Tags</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map(t => (
              <span key={t.tagId} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: t.tag.color + "22", color: t.tag.color }}>
                {t.tag.name}
                <button onClick={() => void removeTag(t.tagId)}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {tags.length === 0 && <p className="text-xs text-[var(--texto-terciario)] italic">Nenhuma tag</p>}
          </div>
          <div className="flex gap-1">
            <Input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              placeholder="Nova tag..."
              className="flex-1 h-8 text-xs"
              onKeyDown={e => { if (e.key === "Enter") void addTag(); }}
            />
            <Button size="icon" className="h-8 w-8 bg-[var(--primaria)]" onClick={() => void addTag()} disabled={addingTag || !tagInput.trim()}>
              {addingTag ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-[var(--texto-secundario)] shrink-0 w-28">{label}</span>
      <span className={cn("text-[var(--texto)] flex-1", !value && "text-[var(--texto-terciario)] italic text-xs")}>
        {value ?? "não coletado"}
      </span>
    </div>
  );
}
