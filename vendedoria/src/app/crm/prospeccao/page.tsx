"use client";

// Prospecção — hub único do fluxo B2B:
//   Buscar empresas → Qualificar com IA → Revisar → Abordar (disparo) → Acompanhar
// Cada etapa é uma aba (?aba=), e o stepper no topo mostra onde estão as empresas.

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard, Search, Building2, ClipboardCheck, Send, BarChart3, Plus, Radar,
} from "lucide-react";
import { api, type Org, type Resumo, type Busca } from "@/components/prospeccao/api";
import { AvisosProvider, Carregando, EmptyState, btn } from "@/components/prospeccao/ui";
import { ExecucoesProvider } from "@/components/prospeccao/execucoes";
import { Stepper } from "@/components/prospeccao/Stepper";
import { VisaoGeral } from "@/components/prospeccao/VisaoGeral";
import { Buscas } from "@/components/prospeccao/Buscas";
import { WizardBusca } from "@/components/prospeccao/WizardBusca";
import { Empresas } from "@/components/prospeccao/Empresas";
import { Revisao } from "@/components/prospeccao/Revisao";
import Disparo from "@/components/prospeccao/Disparo";
import Resultados from "@/components/prospeccao/Resultados";
import type { AbaId, Navegar } from "@/components/prospeccao/navegacao";

const ABAS: ReadonlyArray<{ id: AbaId; label: string; icon: typeof Search }> = [
  { id: "geral",      label: "Visão geral", icon: LayoutDashboard },
  { id: "buscas",     label: "Buscas",      icon: Search },
  { id: "empresas",   label: "Empresas",    icon: Building2 },
  { id: "revisao",    label: "Revisão",     icon: ClipboardCheck },
  { id: "disparo",    label: "Disparo",     icon: Send },
  { id: "resultados", label: "Resultados",  icon: BarChart3 },
];


function isAba(v: string | null): v is AbaId {
  return ABAS.some((a) => a.id === v);
}

function ProspeccaoHub() {
  const router = useRouter();
  const sp = useSearchParams();
  const aba: AbaId = isAba(sp.get("aba")) ? (sp.get("aba") as AbaId) : "geral";

  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ aberto: boolean; editar?: Busca; duplicar?: Busca }>({ aberto: false });

  useEffect(() => {
    api<Org[]>("/api/prospeccao/orgs")
      .then((o) => {
        setOrgs(o);
        let salvo: string | null = null;
        try { salvo = localStorage.getItem("nexo-prospeccao-org"); } catch { /* sem storage */ }
        setOrgId(o.find((x) => x.id === salvo)?.id ?? o[0]?.id ?? null);
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  const carregarResumo = useCallback(async () => {
    if (!orgId) return;
    try {
      setResumo(await api<Resumo>(`/api/prospeccao/resumo/${orgId}`));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [orgId]);

  useEffect(() => { void carregarResumo(); }, [carregarResumo, aba]);

  // Enquanto alguma busca roda no servidor, mantém o resumo fresco.
  const algumaBuscando = resumo?.buscas.some((b) => b.buscando) ?? false;
  useEffect(() => {
    if (!algumaBuscando) return;
    const iv = setInterval(() => void carregarResumo(), 10_000);
    return () => clearInterval(iv);
  }, [algumaBuscando, carregarResumo]);

  const navegar: Navegar = useCallback((destino, params = {}) => {
    const q = new URLSearchParams({ aba: destino, ...params });
    router.replace(`/crm/prospeccao?${q.toString()}`, { scroll: false });
  }, [router]);

  const trocarOrg = (id: string) => {
    setOrgId(id);
    setResumo(null);
    try { localStorage.setItem("nexo-prospeccao-org", id); } catch { /* sem storage */ }
  };

  const org = orgs?.find((o) => o.id === orgId) ?? null;

  if (erro && !resumo) {
    return <EmptyState icon={<Radar className="w-6 h-6" />} titulo="Não foi possível carregar a Prospecção" descricao={erro} />;
  }
  if (orgs === null) return <Carregando />;
  if (!org) {
    return (
      <EmptyState
        icon={<Radar className="w-6 h-6" />}
        titulo="Nenhuma organização de prospecção configurada"
        descricao="Cadastre uma organização do tipo PROSPECÇÃO (seed: npx tsx prisma/seed-nexo.ts) e recarregue a página."
      />
    );
  }

  const contador: Partial<Record<AbaId, number>> = {
    buscas: resumo?.buscas.length,
    revisao: resumo?.etapas.revisar,
  };

  return (
    <ExecucoesProvider onConcluido={carregarResumo}>
      <div className="flex flex-col h-full min-h-0">
        {/* Cabeçalho */}
        <div className="border-b border-border bg-card">
          <div className="flex items-center justify-between gap-3 px-4 md:px-6 pt-4 pb-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">Prospecção</h1>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                Encontre empresas, qualifique com IA, aprove e aborde pelo WhatsApp
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {orgs.length > 1 && (
                <select
                  value={org.id}
                  onChange={(e) => trocarOrg(e.target.value)}
                  className="hidden sm:block rounded-lg border border-border bg-background text-foreground px-2 py-2 text-sm outline-none focus:border-primary"
                >
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
              <button onClick={() => setWizard({ aberto: true })} className={btn.primario}>
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nova busca</span>
              </button>
            </div>
          </div>

          <Stepper resumo={resumo} navegar={navegar} />

          {/* Abas */}
          <nav className="flex gap-1 px-2 md:px-4 overflow-x-auto scrollbar-none" aria-label="Seções da prospecção">
            {ABAS.map((a) => {
              const ativo = a.id === aba;
              const n = contador[a.id];
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  onClick={() => navegar(a.id)}
                  aria-current={ativo ? "page" : undefined}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    ativo ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {a.label}
                  {n ? (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      a.id === "revisao" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"
                    }`}>{n}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-h-0 flex flex-col bg-background">
          {aba === "geral" && (
            <VisaoGeral resumo={resumo} navegar={navegar} novaBusca={() => setWizard({ aberto: true })} />
          )}
          {aba === "buscas" && (
            <Buscas
              resumo={resumo}
              navegar={navegar}
              recarregar={carregarResumo}
              novaBusca={() => setWizard({ aberto: true })}
              editar={(b) => setWizard({ aberto: true, editar: b })}
              duplicar={(b) => setWizard({ aberto: true, duplicar: b })}
            />
          )}
          {aba === "empresas" && (
            <Empresas
              key={`${org.id}:${sp.get("segmentId") ?? ""}:${sp.get("etapa") ?? ""}:${sp.get("status") ?? ""}`}
              orgId={org.id}
              buscas={resumo?.buscas ?? []}
              filtrosIniciais={Object.fromEntries(sp.entries())}
              aoMudar={carregarResumo}
            />
          )}
          {aba === "revisao" && (
            <Revisao
              key={`${org.id}:${sp.get("segmentId") ?? ""}`}
              orgId={org.id}
              segmentIdInicial={sp.get("segmentId") ?? ""}
              buscas={resumo?.buscas ?? []} aoMudar={carregarResumo} navegar={navegar} />
          )}
          {aba === "disparo" && <Disparo key={org.id} org={org} />}
          {aba === "resultados" && (
            <Resultados key={org.id} organizationId={org.id} buscas={resumo?.buscas ?? []} />
          )}
        </div>
      </div>

      {wizard.aberto && (
        <WizardBusca
          orgId={org.id}
          editar={wizard.editar}
          duplicar={wizard.duplicar}
          onClose={() => setWizard({ aberto: false })}
          onSalvo={(id, criado) => {
            setWizard({ aberto: false });
            void carregarResumo();
            if (criado) navegar("buscas", { nova: id });
          }}
        />
      )}
    </ExecucoesProvider>
  );
}

export default function ProspeccaoPage() {
  return (
    <AvisosProvider>
      <Suspense fallback={<Carregando />}>
        <ProspeccaoHub />
      </Suspense>
    </AvisosProvider>
  );
}
