"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Trophy, ClipboardList, CheckCircle2, Clock, ChevronRight, Loader2, Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatPhone } from "@/lib/utils";

const GET_GANHO_LEADS = gql`
  query GetGanhoLeads($organizationId: String!, $leadsPerColumn: Int) {
    getKanbanBoard(organizationId: $organizationId, leadsPerColumn: $leadsPerColumn) {
      columns {
        id name type
        leads {
          id phoneNumber profileName leadOrigin createdAt lastActivityAt
          kanbanColumn { name color type }
        }
      }
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsDelivery {
    whatsappBusinessOrganizations {
      id name status
    }
  }
`;

const CREATE_LEAD = gql`
  mutation CreateLeadDelivery($input: CreateLeadInput!) {
    createLead(input: $input) {
      id
    }
  }
`;

type Lead = {
  id: string;
  phoneNumber: string;
  profileName?: string;
  leadOrigin: string;
  createdAt: string;
  lastActivityAt?: string;
  kanbanColumn: { name: string; color: string; type: string };
  diagnosisStatus?: "none" | "draft" | "finalized";
};

function StatusBadge({ status }: { status: "none" | "draft" | "finalized" }) {
  if (status === "finalized")
    return (
      <Badge className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Diagnóstico concluído
      </Badge>
    );
  if (status === "draft")
    return (
      <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 gap-1">
        <Clock className="w-3 h-3" />
        Em diagnóstico
      </Badge>
    );
  return (
    <Badge className="bg-muted text-muted-foreground gap-1">
      <ClipboardList className="w-3 h-3" />
      Aguardando diagnóstico
    </Badge>
  );
}

export default function DeliveryPage() {
  const { data: orgsData } = useQuery(GET_ORGS);
  const org = orgsData?.whatsappBusinessOrganizations?.find(
    (o: { id: string; status: string }) => o.status === "ACTIVE",
  );

  const { data, loading, refetch } = useQuery(GET_GANHO_LEADS, {
    variables: { organizationId: org?.id, leadsPerColumn: 100 },
    skip: !org?.id,
    fetchPolicy: "cache-and-network",
  });

  const [diagnosisMap, setDiagnosisMap] = useState<Record<string, "none" | "draft" | "finalized">>({});
  const [adicionarOpen, setAdicionarOpen] = useState(false);

  const ganhoColumns = (data?.getKanbanBoard?.columns ?? []).filter(
    (c: { type: string }) => c.type === "GANHO",
  );
  const ganhoColumnId: string = ganhoColumns[0]?.id ?? "";
  const leads: Lead[] = ganhoColumns.flatMap((c: { leads: Lead[] }) => c.leads);

  const fetchDiagnoses = useCallback(async () => {
    if (!leads.length) return;
    const results = await Promise.all(
      leads.map(async (l) => {
        try {
          const res = await fetch(`/api/delivery/${l.id}/diagnosis`);
          const json = await res.json();
          const d = json.diagnosis;
          return [
            l.id,
            !d ? "none" : d.isFinalized ? "finalized" : "draft",
          ] as [string, "none" | "draft" | "finalized"];
        } catch {
          return [l.id, "none"] as [string, "none"];
        }
      }),
    );
    setDiagnosisMap(Object.fromEntries(results));
  }, [leads.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchDiagnoses();
  }, [fetchDiagnoses]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Trophy className="w-5 h-5 text-yellow-400" />
        <div>
          <h1 className="text-lg font-semibold">Funil de Entrega</h1>
          <p className="text-xs text-muted-foreground">Clientes ganhos — diagnóstico e plano de ação</p>
        </div>
        <Badge className="ml-auto bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
          {leads.length} cliente{leads.length !== 1 ? "s" : ""}
        </Badge>
        <Button size="sm" onClick={() => setAdicionarOpen(true)} disabled={!ganhoColumnId}>
          <Plus className="w-4 h-4 mr-1.5" />
          Adicionar cliente
        </Button>
      </div>

      {/* Adicionar cliente */}
      <AdicionarClienteDialog
        open={adicionarOpen}
        onClose={() => setAdicionarOpen(false)}
        organizationId={org?.id ?? ""}
        ganhoColumnId={ganhoColumnId}
        onCreated={() => { setAdicionarOpen(false); void refetch(); }}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && !leads.length ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
            <Trophy className="w-10 h-10 opacity-20" />
            <p className="text-sm">Nenhum lead ganho ainda.</p>
            <p className="text-xs">Leads marcados como "Ganho" no CRM aparecem aqui.</p>
          </div>
        ) : (
          <div className="grid gap-3 max-w-3xl">
            {leads.map((lead) => {
              const status = diagnosisMap[lead.id] ?? "none";
              return (
                <Link
                  key={lead.id}
                  href={`/crm/delivery/${lead.id}`}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border border-border bg-card p-4",
                    "hover:bg-muted/40 transition-colors group",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {lead.profileName || formatPhone(lead.phoneNumber)}
                      </span>
                      {lead.profileName && (
                        <span className="text-xs text-muted-foreground truncate">
                          {formatPhone(lead.phoneNumber)}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdicionarClienteDialog({
  open,
  onClose,
  organizationId,
  ganhoColumnId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  ganhoColumnId: string;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const [createLead, { loading }] = useMutation(CREATE_LEAD, {
    onCompleted: () => {
      setNome(""); setTelefone(""); setErro(null);
      onCreated();
    },
    onError: (e) => setErro(e.message),
  });

  const salvar = () => {
    const tel = telefone.replace(/\D/g, "");
    if (!tel || tel.length < 10) {
      setErro("Informe um telefone válido com DDD.");
      return;
    }
    if (!ganhoColumnId) {
      setErro("Coluna Ganho não encontrada.");
      return;
    }
    void createLead({
      variables: {
        input: {
          phoneNumber: tel.startsWith("55") ? tel : `55${tel}`,
          profileName: nome.trim() || undefined,
          leadOrigin: "OUTBOUND",
          organizationId,
          kanbanColumnId: ganhoColumnId,
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome / Empresa</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Loja Exemplo" />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp (com DDD)</Label>
            <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="62 99999-9999" />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={salvar} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
