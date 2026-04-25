"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2, Clock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface FollowUpSettings {
  id: string;
  maxFollowUps: number;
  followUpHours: string;
  followUpPrompt?: string | null;
}

interface Props {
  onSave: (msg: string) => void;
  onError: (msg: string) => void;
}

export function FollowUpTab({ onSave, onError }: Props) {
  const [settings, setSettings] = useState<FollowUpSettings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState({
    maxFollowUps: 4,
    followUpHours: "4,24,48,72",
    followUpPrompt: "",
  });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/followup");
      if (!r.ok) throw new Error();
      const data: FollowUpSettings = await r.json();
      setSettings(data);
      setForm({
        maxFollowUps:   data.maxFollowUps,
        followUpHours:  data.followUpHours,
        followUpPrompt: data.followUpPrompt ?? "",
      });
    } catch { onError("Erro ao carregar configurações de follow-up"); }
    finally   { setLoading(false); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        maxFollowUps:   form.maxFollowUps,
        followUpHours:  form.followUpHours,
        followUpPrompt: form.followUpPrompt || null,
      };
      const r = await fetch("/api/ai/followup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erro"); }
      await load();
      onSave("Configurações de follow-up salvas!");
    } catch (e) { onError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  // Parse intervals for preview
  const intervals = form.followUpHours.split(",").map(Number).filter(n => !isNaN(n));
  const activeIntervals = intervals.slice(0, form.maxFollowUps);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  if (!settings) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
      AgentConfig não encontrado. Configure o agente principal primeiro.
    </div>
  );

  return (
    <div className="space-y-6 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Define quantas tentativas de retorno o agente faz e em que intervalos.
      </p>

      {/* Max follow-ups */}
      <div className="space-y-2">
        <Label htmlFor="max-followups">Máximo de Follow-ups</Label>
        <div className="flex items-center gap-3">
          <Input
            id="max-followups"
            type="number"
            min={1}
            max={10}
            value={form.maxFollowUps}
            onChange={e => setForm(f => ({ ...f, maxFollowUps: parseInt(e.target.value) || 1 }))}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">tentativas (máx. 10)</span>
        </div>
      </div>

      {/* Intervals */}
      <div className="space-y-2">
        <Label htmlFor="followup-hours">
          Intervalos em Horas
          <span className="text-muted-foreground font-normal ml-1">(separados por vírgula, crescentes)</span>
        </Label>
        <Input
          id="followup-hours"
          value={form.followUpHours}
          onChange={e => setForm(f => ({ ...f, followUpHours: e.target.value }))}
          placeholder="ex: 4,24,48,72"
        />
        <p className="text-xs text-muted-foreground">
          Cada número representa horas após o contato anterior. Mín. 0.5h, máx. 168h (1 semana).
        </p>
      </div>

      {/* Timeline preview */}
      {activeIntervals.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-3">
            <Clock className="w-3.5 h-3.5" />
            Preview da linha do tempo
          </div>
          <div className="flex items-start gap-2 flex-wrap">
            <div className="flex flex-col items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
              <div className="w-0.5 h-5 bg-border" />
            </div>
            <span className="text-xs mt-0.5 text-foreground font-medium">Mensagem do lead</span>
          </div>
          {activeIntervals.map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${i < activeIntervals.length - 1 ? "bg-amber-400" : "bg-slate-400"}`} />
                {i < activeIntervals.length - 1 && <div className="w-0.5 h-5 bg-border" />}
              </div>
              <span className="text-xs mt-0.5 text-muted-foreground">
                <span className="text-foreground font-medium">Follow-up {i + 1}</span>
                {" — "}+{h >= 24 ? `${(h / 24).toFixed(h % 24 === 0 ? 0 : 1)}d` : `${h}h`} após último contato
              </span>
            </div>
          ))}
        </div>
      )}

      {intervals.length < form.maxFollowUps && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Você definiu {form.maxFollowUps} follow-up{form.maxFollowUps > 1 ? "s" : ""} mas só há {intervals.length} intervalo{intervals.length > 1 ? "s" : ""}.
            Adicione mais valores em Intervalos em Horas.
          </span>
        </div>
      )}

      {/* Custom prompt */}
      <div className="space-y-2">
        <Label htmlFor="followup-prompt">
          Prompt de Follow-up
          <span className="text-muted-foreground font-normal ml-1">(opcional)</span>
        </Label>
        <Textarea
          id="followup-prompt"
          value={form.followUpPrompt}
          onChange={e => setForm(f => ({ ...f, followUpPrompt: e.target.value }))}
          placeholder="Instrução extra para o agente ao fazer follow-up. Ex: 'Seja breve e crie senso de urgência com escassez de estoque.'"
          className="min-h-[100px] resize-none text-sm"
        />
        <p className="text-xs text-muted-foreground">{form.followUpPrompt.length} / 3000</p>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar Configurações
      </Button>
    </div>
  );
}
