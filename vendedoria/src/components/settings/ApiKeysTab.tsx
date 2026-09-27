"use client";

// Chaves de API — dão acesso total de ADMIN (GraphQL + Prospecção) sem sessão
// de navegador, para conectar o sistema a ferramentas externas: o MCP server
// deste repo, outro agente de IA, uma automação.

import React, { useCallback, useEffect, useState } from "react";
import { Plug, Plus, Copy, Trash2, Loader2, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ChaveApi {
  id: string;
  nome: string;
  prefixo: string;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
  createdAt: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ApiKeysTab() {
  const [chaves, setChaves] = useState<ChaveApi[] | null>(null);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);
  const [novaChave, setNovaChave] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/api-keys");
      if (!r.ok) throw new Error(`Erro ${r.status}`);
      setChaves(await r.json());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const criar = async () => {
    setCriando(true);
    setErro(null);
    try {
      const r = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim() || "Sem nome" }),
      });
      const data = await r.json() as { chave?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? `Erro ${r.status}`);
      setNovaChave(data.chave ?? null);
      setNome("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCriando(false);
    }
  };

  const revogar = async (id: string, nomeChave: string) => {
    if (!confirm(`Revogar a chave "${nomeChave}"? Qualquer ferramenta usando ela perde o acesso imediatamente.`)) return;
    setRevogando(id);
    try {
      await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
      await carregar();
    } finally {
      setRevogando(null);
    }
  };

  const copiar = async (valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* clipboard indisponível — usuário copia manualmente */ }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Plug className="w-4 h-4" /> Chaves de integração externa</CardTitle>
          <CardDescription>
            Dão acesso total (leitura e edição) ao sistema para ferramentas externas — o servidor MCP
            deste repositório, outro agente de IA, uma automação. Cada chave funciona como um usuário
            admin logado, sem precisar de navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {novaChave && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Copie agora — essa chave não aparece de novo.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 border border-border overflow-x-auto whitespace-nowrap">{novaChave}</code>
                <Button size="sm" variant="outline" onClick={() => void copiar(novaChave)}>
                  {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNovaChave(null)}>Fechar</Button>
            </div>
          )}

          <div className="flex gap-2">
            <Input placeholder="Nome (ex.: MCP server, n8n, Claude)" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Button onClick={() => void criar()} disabled={criando}>
              {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar chave
            </Button>
          </div>

          {erro && <p className="text-sm text-red-500">{erro}</p>}

          {!chaves ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : chaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {chaves.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.nome} {c.revogadaEm && <span className="text-xs text-red-500 font-normal">(revogada)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <code>{c.prefixo}…</code> · usada pela última vez em {fmt(c.ultimoUsoEm)}
                    </p>
                  </div>
                  {!c.revogadaEm && (
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 shrink-0" onClick={() => void revogar(c.id, c.nome)} disabled={revogando === c.id}>
                      {revogando === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Como conectar</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>Envie a chave em qualquer requisição como header <code>Authorization: Bearer &lt;chave&gt;</code>:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li><code>POST /api/graphql</code> — leads, conversas, mensagens, campanhas, agenda, agente, organização (o mesmo schema usado pelo CRM)</li>
            <li><code>/api/prospeccao/*</code> — buscas, empresas, pipeline de qualificação, disparo</li>
          </ul>
          <p>Ou use o servidor MCP em <code>mcp-server/</code> deste repositório — ele já embrulha as duas APIs em ferramentas prontas para qualquer agente compatível com MCP (Claude, etc.). Veja o README lá dentro para configurar.</p>
        </CardContent>
      </Card>
    </div>
  );
}
