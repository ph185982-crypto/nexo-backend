"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Archetype = "Vendedor" | "Consultor" | "Amigo" | "Especialista" | "Coach";

interface PersonalityProfile {
  id: string;
  name: string;
  tone: string;
  archetype: Archetype;
  emoji: string;
  isActive: boolean;
}

interface Props {
  onSave: (msg: string) => void;
  onError: (msg: string) => void;
}

const ARCHETYPES: Archetype[] = ["Vendedor", "Consultor", "Amigo", "Especialista", "Coach"];

const ARCHETYPE_BADGE: Record<Archetype, string> = {
  Vendedor:    "bg-orange-100 text-orange-700 border-orange-200",
  Consultor:   "bg-blue-100   text-blue-700   border-blue-200",
  Amigo:       "bg-green-100  text-green-700  border-green-200",
  Especialista:"bg-violet-100 text-violet-700 border-violet-200",
  Coach:       "bg-rose-100   text-rose-700   border-rose-200",
};

const BLANK = { name: "", tone: "", archetype: "Vendedor" as Archetype, emoji: "👤", isActive: true };

export function PersonaTab({ onSave, onError }: Props) {
  const [profiles, setProfiles] = useState<PersonalityProfile[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<PersonalityProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState(BLANK);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/personality");
      if (!r.ok) throw new Error(await r.text());
      setProfiles(await r.json());
    } catch { onError("Erro ao carregar personas"); }
    finally   { setLoading(false); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(BLANK); setCreating(true); };
  const openEdit   = (p: PersonalityProfile) => {
    setCreating(false);
    setForm({ name: p.name, tone: p.tone, archetype: p.archetype, emoji: p.emoji, isActive: p.isActive });
    setEditing(p);
  };
  const cancel = () => { setCreating(false); setEditing(null); };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url    = editing ? `/api/ai/personality/${editing.id}` : "/api/ai/personality";
      const method = editing ? "PUT" : "POST";
      const body   = editing
        ? { tone: form.tone, archetype: form.archetype, emoji: form.emoji, isActive: form.isActive }
        : form;
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erro"); }
      await load(); cancel();
      onSave(editing ? "Persona atualizada!" : "Persona criada!");
    } catch (e) { onError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta persona? Ela será desvinculada do agente.")) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/ai/personality/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Erro ao excluir");
      await load(); onSave("Persona excluída.");
    } catch { onError("Erro ao excluir persona"); }
    finally { setDeleting(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define a personalidade e tom de voz do agente. Apenas uma persona ativa por vez.
        </p>
        {!creating && !editing && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> Nova Persona
          </Button>
        )}
      </div>

      {/* Inline create / edit form */}
      {(creating || editing) && (
        <div className="border rounded-xl p-4 bg-gray-50 space-y-4">
          <p className="text-sm font-medium text-foreground">
            {editing ? `Editar: ${editing.name}` : "Nova Persona"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Sofia"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Arquétipo *</Label>
              <select
                value={form.archetype}
                onChange={e => setForm(f => ({ ...f, archetype: e.target.value as Archetype }))}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Emoji</Label>
              <Input
                value={form.emoji}
                onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                maxLength={4}
                className="w-20"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Tom de Voz *
              <span className="text-muted-foreground font-normal ml-1">(mín. 20 caracteres)</span>
            </Label>
            <Textarea
              value={form.tone}
              onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
              placeholder="ex: Comunicativa, usa linguagem simples e emojis moderados, cria urgência sem pressão. Faz perguntas curtas e focadas..."
              className="min-h-[90px] resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">{form.tone.length} / 2000</p>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="persona-active"
              checked={form.isActive}
              onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="persona-active">Ativa</Label>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Profile list */}
      {profiles.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-3 py-14 text-muted-foreground">
          <User className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhuma persona cadastrada. Crie a primeira!</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map(p => (
            <div
              key={p.id}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border bg-white transition-colors",
                p.isActive && "border-primary/30 ring-1 ring-primary/20"
              )}
            >
              <span className="text-2xl leading-none flex-shrink-0 mt-0.5">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{p.name}</span>
                  <Badge variant="outline" className={cn("text-xs", ARCHETYPE_BADGE[p.archetype])}>
                    {p.archetype}
                  </Badge>
                  {p.isActive && (
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 bg-emerald-50">
                      ativa
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{p.tone}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(p.id)}
                  disabled={deleting === p.id}
                >
                  {deleting === p.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
