"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ObjType = "PRICE" | "COMPETITOR" | "TIMING" | "DISINTEREST" | "TRUST" | "FEATURE";

interface ObjectionRule {
  id: string;
  keyword: string;
  objectionType: ObjType;
  responseStrategy: string;
  counterArgument: string;
  isActive: boolean;
}

interface Props {
  onSave: (msg: string) => void;
  onError: (msg: string) => void;
}

const OBJ_TYPES: ObjType[] = ["PRICE", "COMPETITOR", "TIMING", "DISINTEREST", "TRUST", "FEATURE"];

const OBJ_LABELS: Record<ObjType, string> = {
  PRICE:       "Preço",
  COMPETITOR:  "Concorrente",
  TIMING:      "Timing",
  DISINTEREST: "Desinteresse",
  TRUST:       "Confiança",
  FEATURE:     "Funcionalidade",
};

const OBJ_BADGE: Record<ObjType, string> = {
  PRICE:       "bg-red-100    text-red-700    border-red-200",
  COMPETITOR:  "bg-blue-100   text-blue-700   border-blue-200",
  TIMING:      "bg-amber-100  text-amber-700  border-amber-200",
  DISINTEREST: "bg-slate-100  text-slate-600  border-slate-200",
  TRUST:       "bg-violet-100 text-violet-700 border-violet-200",
  FEATURE:     "bg-cyan-100   text-cyan-700   border-cyan-200",
};

const BLANK = {
  keyword: "", objectionType: "PRICE" as ObjType,
  responseStrategy: "", counterArgument: "", isActive: true,
};

export function ObjectionsTab({ onSave, onError }: Props) {
  const [rules,    setRules]    = useState<ObjectionRule[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<ObjectionRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState(BLANK);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/objections");
      if (!r.ok) throw new Error();
      setRules(await r.json());
    } catch { onError("Erro ao carregar objeções"); }
    finally   { setLoading(false); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(BLANK); setCreating(true); };
  const openEdit   = (r: ObjectionRule) => {
    setCreating(false);
    setForm({
      keyword: r.keyword, objectionType: r.objectionType,
      responseStrategy: r.responseStrategy, counterArgument: r.counterArgument, isActive: r.isActive,
    });
    setEditing(r);
  };
  const cancel = () => { setCreating(false); setEditing(null); };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url    = editing ? `/api/ai/objections/${editing.id}` : "/api/ai/objections";
      const method = editing ? "PUT" : "POST";
      const body   = editing
        ? { objectionType: form.objectionType, responseStrategy: form.responseStrategy, counterArgument: form.counterArgument, isActive: form.isActive }
        : form;
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erro"); }
      await load(); cancel();
      onSave(editing ? "Regra atualizada!" : "Regra de objeção criada!");
    } catch (e) { onError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta regra de objeção?")) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/ai/objections/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      await load(); onSave("Regra excluída.");
    } catch { onError("Erro ao excluir"); }
    finally { setDeleting(null); }
  };

  const handleToggle = async (rule: ObjectionRule) => {
    try {
      const r = await fetch(`/api/ai/objections/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!r.ok) throw new Error();
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
          Regras de como o agente responde quando detecta uma objeção por palavra-chave.
        </p>
        {!creating && !editing && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> Nova Regra
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <div className="border rounded-xl p-4 bg-gray-50 space-y-4">
          <p className="text-sm font-medium">
            {editing ? `Editar: "${editing.keyword}"` : "Nova Regra de Objeção"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>Palavra-chave *</Label>
                <Input
                  value={form.keyword}
                  onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                  placeholder="ex: caro, concorrente, não preciso"
                />
                <p className="text-xs text-muted-foreground">Será normalizada para minúsculas</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Tipo de Objeção *</Label>
              <select
                value={form.objectionType}
                onChange={e => setForm(f => ({ ...f, objectionType: e.target.value as ObjType }))}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {OBJ_TYPES.map(t => <option key={t} value={t}>{OBJ_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estratégia de Resposta *</Label>
            <Textarea
              value={form.responseStrategy}
              onChange={e => setForm(f => ({ ...f, responseStrategy: e.target.value }))}
              placeholder="Como o agente deve abordar esta objeção? ex: Mostre o valor antes do preço, ofereça parcelamento..."
              className="min-h-[80px] resize-none text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Contra-argumento *</Label>
            <Textarea
              value={form.counterArgument}
              onChange={e => setForm(f => ({ ...f, counterArgument: e.target.value }))}
              placeholder="O argumento concreto a usar. ex: Nosso produto tem garantia de 2 anos inclusa no preço..."
              className="min-h-[80px] resize-none text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="obj-active"
              checked={form.isActive}
              onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="obj-active">Ativa</Label>
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
          <MessageSquareWarning className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhuma regra de objeção. Crie a primeira!</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border bg-white overflow-hidden">
          {rules.map(rule => (
            <div key={rule.id} className={cn("flex items-start gap-3 px-4 py-3", !rule.isActive && "opacity-50")}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-700">
                    {rule.keyword}
                  </code>
                  <Badge variant="outline" className={cn("text-xs", OBJ_BADGE[rule.objectionType])}>
                    {OBJ_LABELS[rule.objectionType]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">{rule.responseStrategy}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={() => handleToggle(rule)}
                  className="scale-75"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rule)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(rule.id)} disabled={deleting === rule.id}
                >
                  {deleting === rule.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
