"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, gql } from "@apollo/client";
import { Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const GET_ORGS = gql`query { whatsappBusinessOrganizations { id name } }`;

const ETAPAS = [
  { id: "NOVO",                label: "Novo",            color: "bg-gray-100 border-gray-300" },
  { id: "PRODUTO_IDENTIFICADO",label: "Qualificando",    color: "bg-blue-50 border-blue-300" },
  { id: "NEGOCIANDO",          label: "Negociando",      color: "bg-yellow-50 border-yellow-300" },
  { id: "COLETANDO_DADOS",     label: "Coletando dados", color: "bg-orange-50 border-orange-300" },
  { id: "PEDIDO_CONFIRMADO",   label: "Confirmado",      color: "bg-green-50 border-green-300" },
  { id: "PERDIDO",             label: "Perdido",         color: "bg-red-50 border-red-300" },
] as const;

const AVG_PRICE = 539.99;

interface ConvData { id: string; etapa: string; produtoInteresse: string | null; localizacaoRecebida: boolean; humanTakeover: boolean; lastMessageAt: string | null }
interface Lead {
  id: string; profileName: string | null; phoneNumber: string;
  conversations: ConvData[];
  tags: Array<{ tagId: string; tag: { name: string; color: string } }>;
}

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  return local || raw;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function isStale(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diff = Date.now() - new Date(dateStr).getTime();
  const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hora = brNow.getUTCHours();
  const dia = brNow.getUTCDay();
  const horarioComercial = (dia >= 1 && dia <= 5 && hora >= 9 && hora < 18) || (dia === 6 && hora >= 8 && hora < 13);
  return horarioComercial && diff > 60 * 60 * 1000;
}

export default function PipelinePage() {
  const router = useRouter();
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];
  const [orgId, setOrgId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => { if (!orgId && orgs.length > 0) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const fetchLeads = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/leads?organizationId=${orgId}`);
      setLeads(await r.json() as Lead[]);
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void fetchLeads(); }, [fetchLeads]);

  const moveCard = useCallback(async (leadId: string, etapa: string) => {
    setLeads(prev => prev.map(l => {
      if (l.id !== leadId) return l;
      const convs = l.conversations.map((c, i) => i === 0 ? { ...c, etapa } : c);
      return { ...l, conversations: convs };
    }));
    await fetch(`/api/leads/${leadId}/etapa`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etapa }),
    });
  }, []);

  const getEtapa = (l: Lead) => l.conversations[0]?.etapa ?? "NOVO";
  const getProduto = (l: Lead) => l.conversations[0]?.produtoInteresse;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--fundo)]">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <h1 className="font-semibold text-[var(--texto)]">Pipeline</h1>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full p-4 min-w-max">
          {ETAPAS.map((etapa) => {
            const colLeads = leads.filter(l => getEtapa(l) === etapa.id);
            const valor = colLeads.length * AVG_PRICE;
            return (
              <div
                key={etapa.id}
                className={cn("flex flex-col rounded-xl border-2 bg-white w-64 shrink-0 overflow-hidden", etapa.color)}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={async () => { if (dragId) { await moveCard(dragId, etapa.id); setDragId(null); } }}
              >
                {/* Column header */}
                <div className="px-3 py-2.5 border-b bg-white/80">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--texto)]">{etapa.label}</span>
                    <span className="text-xs font-bold bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{colLeads.length}</span>
                  </div>
                  {colLeads.length > 0 && (
                    <p className="text-[11px] text-[var(--texto-secundario)] mt-0.5">
                      R$ {(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {colLeads.map((lead) => {
                    const conv = lead.conversations[0];
                    const stale = isStale(conv?.lastMessageAt ?? null);
                    const produto = getProduto(lead);
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDragId(lead.id)}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => router.push(`/crm/conversations?id=${conv?.id ?? ""}`)}
                        className={cn(
                          "bg-white rounded-lg border p-2.5 cursor-pointer shadow-sm hover:shadow-md transition-all select-none",
                          stale && "border-red-300 animate-pulse ring-1 ring-red-200",
                          dragId === lead.id && "opacity-50"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {(lead.profileName ?? lead.phoneNumber)?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <p className="text-sm font-medium text-[var(--texto)] truncate flex-1">
                            {lead.profileName ?? formatPhone(lead.phoneNumber)}
                          </p>
                        </div>

                        {produto && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium mb-1">
                            🔧 {produto.replace("_", " ")}
                          </span>
                        )}

                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn("text-[10px] flex items-center gap-0.5", stale ? "text-red-600 font-semibold" : "text-[var(--texto-terciario)]")}>
                            ⏱ {timeAgo(conv?.lastMessageAt ?? null)}
                          </span>
                          {conv?.localizacaoRecebida && <span className="text-[10px] text-emerald-600">📍</span>}
                          {conv?.humanTakeover && <span className="text-[10px] text-blue-600">👤</span>}
                        </div>
                      </div>
                    );
                  })}
                  {colLeads.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-[var(--texto-terciario)]">
                      <MessageSquare className="w-6 h-6 mb-1 opacity-30" />
                      <p className="text-xs">Vazio</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
