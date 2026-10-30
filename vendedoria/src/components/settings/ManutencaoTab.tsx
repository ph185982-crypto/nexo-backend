"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Previa { escopo: "escalados" | "outbound"; descricao?: string; destino?: string; quantidade: number; erro?: string }

const TITULOS: Record<Previa["escopo"], string> = {
  escalados: "Leads escalados presos em \"Novos\"",
  outbound: "Leads de prospecção em \"Novos\"",
};

// Correções de dados do Kanban. Cada botão mostra primeiro quantos cards vai
// mover e só aplica depois de confirmar. Nenhum lead é apagado.
export function ManutencaoTab({ orgId }: { orgId: string }) {
  const [previas, setPrevias] = useState<Previa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!orgId) return;
    setCarregando(true);
    try {
      const res = await fetch(`/api/admin/kanban/sincronizar?organizationId=${orgId}`);
      const data = await res.json();
      setPrevias(data.previas ?? []);
    } catch {
      setMensagem("Não consegui carregar a prévia");
    } finally {
      setCarregando(false);
    }
  }, [orgId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const aplicar = async (p: Previa) => {
    if (!confirm(`Mover ${p.quantidade} card(s) para "${p.destino}"? Nada é apagado; fica registrado na atividade de cada lead.`)) return;
    setAplicando(p.escopo);
    setMensagem(null);
    try {
      const res = await fetch("/api/admin/kanban/sincronizar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId, escopo: p.escopo }),
      });
      const data = await res.json();
      setMensagem(data.erro ? `Erro: ${data.erro}` : `${data.movidos} card(s) movido(s) para "${data.destino}"`);
      await carregar();
    } catch {
      setMensagem("Falha ao aplicar");
    } finally {
      setAplicando(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Correções do Kanban
            <Button size="sm" variant="ghost" onClick={() => void carregar()} disabled={carregando}>
              {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </CardTitle>
          <CardDescription>
            Cards que ficaram na coluna errada por versões antigas do sistema. Cada ação mostra a quantidade antes de aplicar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {previas.map((p) => (
            <div key={p.escopo} className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg">
              <div className="min-w-0">
                <p className="text-sm font-medium">{TITULOS[p.escopo]}</p>
                <p className="text-xs text-muted-foreground">
                  {p.erro ? p.erro : `${p.quantidade} card(s) → "${p.destino}"`}
                </p>
              </div>
              <Button size="sm" disabled={!!p.erro || p.quantidade === 0 || aplicando !== null} onClick={() => void aplicar(p)}>
                {aplicando === p.escopo ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
              </Button>
            </div>
          ))}
          {previas.length === 0 && !carregando && <p className="text-sm text-muted-foreground">Nenhuma prévia disponível.</p>}
          {mensagem && <p className="text-sm">{mensagem}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
