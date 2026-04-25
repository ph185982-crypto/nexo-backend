"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConstraintRule {
  id: string;
  title: string;
  rule: string;
  reason?: string | null;
  isActive: boolean;
}

interface Props {
  onSave: (msg: string) => void;
  onError: (msg: string) => void;
}

const BLANK = { title: "", rule: "", reason: "", isActive: true };

export function ConstraintsTab({ onSave, onError }: Props) {
  const [rules,    setRules]    = useState<ConstraintRule[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<ConstraintRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState(BLANK);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/constraints");
      if (!r.ok) throw new Error();
      setRules(await r.json());
    } catch { onError("Erro ao carregar restrições"); }
    finally   { setLoading(false); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(BLANK); setCreating(true); };
  const openEdit   = (r: ConstraintRule) => {
    setCreating(false);
    setForm({ title: r.title, rule: r.rule, reason: r.reason ?? "", isActive: r.isActive });
    setEditing(r);
  };
  const cancel = () => { setCreating(false); setEditing(null); };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url    = editing ? `/api/ai/constraints/${editing.id}` : "/api/ai/constraints";
      const method = editing ? "PUT" : "POST";
      const body   = editing
        ? { rule: form.rule, reason: form.reason || undefined, isActive: form.isActive }
        : { title: form.title, rule: form.rule, reason: form.reason || undefined, isActive: form.isActive };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erro"); }
      await load(); cancel();
      onSave(editing ? "Restrição atualizada!" : "Restrição criada!");
    } catch (e) { onError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta restrição?")) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/ai/constraints/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      await load(); onSave("Restrição excluída.");
    } catch { onError("Erro ao excluir"); }
    finally { setDeleting(null); }
  };

  const handleToggle = async (rule: ConstraintRule) => {
    try {
      await fetch(`/api/ai/constraints/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      await load();
    } catch { onError("Erro ao alterar status"); }
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
          Barreiras que o agente nunca deve ultrapassar, independente da conversa.
        </p>
        {!creating && !editing && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> Nova Restrição
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <div className="border rounded-xl p-4 bg-gray-50 space-y-4">
          <p className="text-sm font-medium">
            {editing ? `Editar: "${editing.title}"` : "Nova Restrição"}
          </p>

          {!editing && (
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="ex: Sem desconto acima de 20%"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Regra * <span className="text-muted-foreground font-normal">(instrução direta ao agente)</span></Label>
            <Textarea
              value={form.rule}
              onChange={e => setForm(f => ({ ...f, rule: e.target.value }))}
              placeholder="ex: Nunca ofereça desconto superior a 20% sem aprovação explícita do gerente."
              className="min-h-[80px] resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">{form.rule.length} / 500</p>
          </div>

          <div className="space-y-1.5">
            <Label>Motivo <span className="text-muted-foreground font-normal">(opcional — contexto interno)</span></Label>
            <Input
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="ex: Política comercial aprovada em reunião de nov/2024"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="constraint-active"
              checked={form.isActive}
              onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="constraint-active">Ativa</Label>
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

      {rules.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-3 py-14 text-muted-foreground">
          <ShieldAlert className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhuma restrição cadastrada.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rules.map(rule => (
            <div
              key={rule.id}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border bg-white",
                !rule.isActive && "opacity-50"
              )}
            >
              <ShieldAlert className={cn("w-4 h-4 mt-0.5 flex-shrink-0", rule.isActive ? "text-amber-500" : "text-muted-foreground")} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{rule.title}</span>
                  {!rule.isActive && <Badge variant="outline" className="text-xs text-muted-foreground">inativa</Badge>}
                </div>
                <p className="text-xs text-foreground/80 mb-1 leading-relaxed">{rule.rule}</p>
                {rule.reason && (
                  <p className="text-xs text-muted-foreground italic">Motivo: {rule.reason}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch checked={rule.isActive} onCheckedChange={() => handleToggle(rule)} className="scale-75" />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(rule)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(rule.id)} disabled={deleting === rule.id}
                >
                  {deleting === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
