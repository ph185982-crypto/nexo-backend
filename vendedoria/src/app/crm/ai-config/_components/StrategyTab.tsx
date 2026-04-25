"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Urgency = "low" | "medium" | "high";

interface StrategyProfile {
  id: string;
  name: string;
  description: string;
  salesGoal: string;
  urgency: Urgency;
  isActive: boolean;
}

interface Props {
  onSave: (msg: string) => void;
  onError: (msg: string) => void;
}

const URGENCY_LABEL: Record<Urgency, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const URGENCY_BADGE: Record<Urgency, string> = {
  low:    "bg-slate-100  text-slate-600  border-slate-200",
  medium: "bg-amber-100  text-amber-700  border-amber-200",
  high:   "bg-red-100    text-red-700    border-red-200",
};

const BLANK = { name: "", description: "", salesGoal: "", urgency: "medium" as Urgency, isActive: true };

export function StrategyTab({ onSave, onError }: Props) {
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<StrategyProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState(BLANK);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/strategy");
      if (!r.ok) throw new Error();
      setProfiles(await r.json());
    } catch { onError("Erro ao carregar estratégias"); }
    finally   { setLoading(false); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(BLANK); setCreating(true); };
  const openEdit   = (p: StrategyProfile) => {
    setCreating(false);
    setForm({ name: p.name, description: p.description, salesGoal: p.salesGoal, urgency: p.urgency, isActive: p.isActive });
    setEditing(p);
  };
  const cancel = () => { setCreating(false); setEditing(null); };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url    = editing ? `/api/ai/strategy/${editing.id}` : "/api/ai/strategy";
      const method = editing ? "PUT" : "POST";
      const body   = editing
        ? { description: form.description, salesGoal: form.salesGoal, urgency: form.urgency, isActive: form.isActive }
        : form;
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erro"); }
      await load(); cancel();
      onSave(editing ? "Estratégia atualizada!" : "Estratégia criada!");
    } catch (e) { onError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta estratégia?")) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/ai/strategy/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      await load(); onSave("Estratégia excluída.");
    } catch { onError("Erro ao excluir"); }
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
          Define o objetivo de venda e o nível de urgência aplicado pelo agente.
        </p>
        {!creating && !editing && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> Nova Estratégia
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <div className="border rounded-xl p-4 bg-gray-50 space-y-4">
          <p className="text-sm font-medium">{editing ? `Editar: ${editing.name}` : "Nova Estratégia"}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Fechar em 3 Contatos"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Urgência</Label>
              <select
                value={form.urgency}
                onChange={e => setForm(f => ({ ...f, urgency: e.target.value as Urgency }))}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="low">Baixa — sem pressa</option>
                <option value="medium">Média — equilibrada</option>
                <option value="high">Alta — fecha logo</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Objetivo de Venda *</Label>
            <Input
              value={form.salesGoal}
              onChange={e => setForm(f => ({ ...f, salesGoal: e.target.value }))}
              placeholder="ex: Converter para pedido em até 3 interações"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição *</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Descreva a abordagem detalhada: quando usar, quais gatilhos, como escalar..."
              className="min-h-[90px] resize-none text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="strategy-active"
              checked={form.isActive}
              onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="strategy-active">Ativa</Label>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>Cancelar</Button>
          </div>
        </div>
      )}

      {profiles.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-3 py-14 text-muted-foreground">
          <Target className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhuma estratégia cadastrada. Crie a primeira!</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map(p => (
            <div
              key={p.id}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border bg-white",
                p.isActive && "border-primary/30 ring-1 ring-primary/20"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{p.name}</span>
                  <Badge variant="outline" className={cn("text-xs", URGENCY_BADGE[p.urgency])}>
                    Urgência: {URGENCY_LABEL[p.urgency]}
                  </Badge>
                  {p.isActive && (
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 bg-emerald-50">ativa</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1 mb-1">
                  <span className="font-medium text-foreground">Meta:</span> {p.salesGoal}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                >
                  {deleting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
