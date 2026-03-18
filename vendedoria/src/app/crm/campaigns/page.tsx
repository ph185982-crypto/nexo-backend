"use client";

import React, { useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import { useRouter } from "next/navigation";
import {
  Rocket, Plus, Search, Download, Settings, Play, Pause,
  Eye, Loader2, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn, formatDateTime } from "@/lib/utils";

const GET_CAMPAIGNS = gql`
  query GetCampaigns($organizationId: String!, $status: String, $search: String, $periodDays: Int) {
    getCampaigns(organizationId: $organizationId, status: $status, search: $search, periodDays: $periodDays) {
      campaigns {
        id name status objective mode scheduledAt createdAt
        totalRecipients sentCount failedCount repliedCount
        sender { id accountName displayPhoneNumber }
      }
      total
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsCampaigns {
    whatsappBusinessOrganizations { id name status }
  }
`;

const START_CAMPAIGN = gql`
  mutation StartCampaign($id: String!) {
    startCampaign(id: $id) { id status }
  }
`;

const PAUSE_CAMPAIGN = gql`
  mutation PauseCampaign($id: String!) {
    pauseCampaign(id: $id) { id status }
  }
`;

const PERIOD_FILTERS = [
  { label: "Todas", value: "" },
  { label: "Hoje", value: "1" },
  { label: "7 Dias", value: "7" },
  { label: "15 Dias", value: "15" },
  { label: "30 Dias", value: "30" },
];

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "info" }> = {
  PLANNING: { label: "Rascunho", variant: "muted" },
  ACTIVE: { label: "Ativo", variant: "success" },
  PAUSED: { label: "Pausado", variant: "warning" },
  COMPLETED: { label: "Concluído", variant: "info" },
  CANCELLED: { label: "Cancelado", variant: "destructive" },
};

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  mode: string;
  scheduledAt?: string;
  createdAt: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  sender?: { id: string; accountName: string; displayPhoneNumber: string };
}

function CampaignCard({
  campaign,
  onView,
  onStart,
  onPause,
}: {
  campaign: Campaign;
  onView: () => void;
  onStart: () => void;
  onPause: () => void;
}) {
  const statusInfo = STATUS_LABELS[campaign.status] ?? { label: campaign.status, variant: "muted" as const };
  const successRate = campaign.totalRecipients > 0
    ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100)
    : 0;
  const replyRate = campaign.sentCount > 0
    ? Math.round((campaign.repliedCount / campaign.sentCount) * 100)
    : 0;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base truncate">{campaign.name}</h3>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {campaign.sender?.accountName ?? "—"} • {formatDateTime(campaign.createdAt)}
              {campaign.scheduledAt && ` • Agendado: ${formatDateTime(campaign.scheduledAt)}`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {campaign.status === "PLANNING" && (
              <Button size="sm" onClick={onStart} className="gap-1">
                <Play className="w-3 h-3" />
                Iniciar
              </Button>
            )}
            {campaign.status === "ACTIVE" && (
              <Button size="sm" variant="outline" onClick={onPause} className="gap-1">
                <Pause className="w-3 h-3" />
                Pausar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onView}>
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
          <div className="text-center">
            <p className="text-lg font-bold text-primary">{campaign.sentCount}</p>
            <p className="text-xs text-muted-foreground">Enviados</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-muted-foreground">/</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">{campaign.totalRecipients}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${successRate}%` }}
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-green-600">{successRate}%</p>
            <p className="text-xs text-muted-foreground">Taxa Envio</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-blue-600">{replyRate}%</p>
            <p className="text-xs text-muted-foreground">Responderam</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = orgsData?.whatsappBusinessOrganizations ?? [];
  const orgId = selectedOrgId || orgs[0]?.id || "";

  const { data, loading, refetch } = useQuery(GET_CAMPAIGNS, {
    variables: {
      organizationId: orgId,
      status: statusFilter || undefined,
      search: search || undefined,
      periodDays: periodFilter ? Number(periodFilter) : undefined,
    },
    skip: !orgId,
    fetchPolicy: "cache-and-network",
  });

  const [startCampaign] = useMutation(START_CAMPAIGN, { onCompleted: () => refetch() });
  const [pauseCampaign] = useMutation(PAUSE_CAMPAIGN, { onCompleted: () => refetch() });

  const campaigns: Campaign[] = data?.getCampaigns?.campaigns ?? [];

  // Mock chart data
  const chartData = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    enviados: Math.floor(Math.random() * 200 + 50),
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Rocket className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Gerenciador de Campanhas</h1>
            <p className="text-xs text-muted-foreground">
              Crie e gerencie campanhas de WhatsApp em massa
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-44 bg-white">
              <SelectValue placeholder="Organização" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o: { id: string; name: string }) => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => router.push(`/crm/campaign/new/${orgId}`)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Nova Campanha
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-56 bg-white"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-white">
            <SelectValue placeholder="Todos os Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos os Status</SelectItem>
            <SelectItem value="PLANNING">Rascunho</SelectItem>
            <SelectItem value="ACTIVE">Ativo</SelectItem>
            <SelectItem value="PAUSED">Pausado</SelectItem>
            <SelectItem value="COMPLETED">Concluído</SelectItem>
          </SelectContent>
        </Select>

        {/* Period tabs */}
        <div className="flex bg-white border border-border rounded-md overflow-hidden">
          {PERIOD_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setPeriodFilter(f.value)}
              className={cn(
                "px-3 py-2 text-sm transition-colors",
                periodFilter === f.value
                  ? "bg-primary text-white font-medium"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm">
          <Download className="w-4 h-4 mr-1.5" />
          Exportar
        </Button>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            Envios por Dia
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="enviados" fill="#004c3f" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Campaign List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12">
          <Rocket className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">
            Nenhuma campanha encontrada
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Crie sua primeira campanha para começar
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onView={() => router.push(`/crm/campaign/view/${campaign.id}`)}
              onStart={() => startCampaign({ variables: { id: campaign.id } })}
              onPause={() => pauseCampaign({ variables: { id: campaign.id } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
