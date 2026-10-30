"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { gql, useQuery } from "@apollo/client";
import { Loader2, Phone, MessageSquare, Check, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIntervaloVisivel } from "@/hooks/useIntervaloVisivel";
import type { FilaDeLigacoes, LigacaoMarcada, LigacaoPendente } from "@/lib/crm/ligacoes";

const GET_ORGS = gql`query GetOrgsLigacoes { whatsappBusinessOrganizations { id name status } }`;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Contato({ telefone, conversationId }: { telefone: string | null; conversationId: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      {telefone && (
        <a href={`tel:+${telefone}`}><Button size="sm" variant="outline" className="gap-1"><Phone className="w-3.5 h-3.5" /> Ligar</Button></a>
      )}
      {telefone && (
        <a href={`https://wa.me/${telefone}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1"><MessageSquare className="w-3.5 h-3.5" /> WhatsApp</Button></a>
      )}
      {conversationId && (
        <Link href={`/crm/conversations?id=${conversationId}`}><Button size="sm" variant="ghost">Abrir conversa</Button></Link>
      )}
    </div>
  );
}

export default function LigacoesPage() {
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = (orgsData?.whatsappBusinessOrganizations ?? []) as Array<{ id: string; name: string; status: string }>;
  const orgId = orgs.find((o) => o.status === "ACTIVE")?.id ?? orgs[0]?.id ?? "";
  const [fila, setFila] = useState<FilaDeLigacoes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!orgId) return;
    setCarregando(true);
    try {
      const res = await fetch(`/api/ligacoes?organizationId=${orgId}`);
      if (res.ok) setFila(await res.json());
    } finally {
      setCarregando(false);
    }
  }, [orgId]);

  useEffect(() => { void carregar(); }, [carregar]);
  useIntervaloVisivel(() => void carregar(), 60_000, Boolean(orgId));

  const concluir = async (p: LigacaoPendente) => {
    setOcupado(p.notificacaoId);
    try {
      await fetch(`/api/notifications/${p.notificacaoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
      setFila((f) => f ? { ...f, pendentes: f.pendentes.filter((x) => x.notificacaoId !== p.notificacaoId) } : f);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2"><PhoneCall className="w-5 h-5" /> Ligações</h1>
        {carregando && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marcadas pelo SDR ({fila?.marcadas.length ?? 0})</CardTitle>
          <CardDescription>Leads que escolheram um horário para falar com você.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fila?.marcadas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ligação marcada.</p>}
          {fila?.marcadas.map((m: LigacaoMarcada) => (
            <div key={m.leadId} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{m.nome}{m.empresa ? <span className="text-muted-foreground font-normal"> · {m.empresa}</span> : null}</p>
                <p className="text-sm font-semibold">{fmt(m.quando)}</p>
              </div>
              {m.dor && <p className="text-sm text-muted-foreground">Dor: {m.dor}</p>}
              <Contato telefone={m.telefone} conversationId={m.conversationId} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Para ligar ({fila?.pendentes.length ?? 0})</CardTitle>
          <CardDescription>Leads escalados, que pararam de responder ou que pediram uma pessoa. Marque como concluído depois de falar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fila?.pendentes.length === 0 && <p className="text-sm text-muted-foreground">Fila vazia 🎉</p>}
          {fila?.pendentes.map((p: LigacaoPendente) => (
            <div key={p.notificacaoId} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{p.nome}{p.empresa ? <span className="text-muted-foreground font-normal"> · {p.empresa}</span> : null}</p>
                <p className="text-xs text-muted-foreground">{fmt(p.criadoEm)}</p>
              </div>
              <p className="text-sm">{p.titulo}</p>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Resumo</summary><pre className="whitespace-pre-wrap font-sans mt-1">{p.resumo}</pre></details>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Contato telefone={p.telefone} conversationId={p.conversationId} />
                <Button size="sm" onClick={() => void concluir(p)} disabled={ocupado === p.notificacaoId} className="gap-1">
                  {ocupado === p.notificacaoId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Concluído
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
