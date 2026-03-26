"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  ArrowLeft, Play, Pause, Download, Copy, Edit2, Wifi, RefreshCw,
  Loader2, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn, formatDateTime } from "@/lib/utils";

const GET_CAMPAIGN = gql`
  query GetCampaignDetail($id: String!) {
    getCampaign(id: $id) {
      id name status mode objective scheduledAt createdAt
      templateMessage dailyStartTime dailyEndTime maxMessagesPerMinute
      totalRecipients sentCount failedCount repliedCount
      sender { id accountName displayPhoneNumber status }
    }
    getCampaignStats(id: $id) {
      totalRecipients sent failed replied successRate replyRate
    }
  }
`;

const GET_RECIPIENTS = gql`
  query GetRecipients($id: String!, $page: Int, $pageSize: Int) {
    getCampaignRecipientsTable(id: $id, page: $page, pageSize: $pageSize) {
      recipients { id phoneNumber name status sentAt }
      total page pageSize
    }
  }
`;

const GET_REPLY_RATE = gql`
  query GetReplyRate($id: String!) {
    campaignReplyRate(id: $id) { date sent replied }
  }
`;

const START_CAMPAIGN = gql`
  mutation StartCampaignDetail($id: String!) {
    startCampaign(id: $id) { id status }
  }
`;

const PAUSE_CAMPAIGN = gql`
  mutation PauseCampaignDetail($id: String!) {
    pauseCampaign(id: $id) { id status }
  }
`;

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PLANNING: { label: "Rascunho", className: "bg-gray-100 text-gray-700" },
  ACTIVE: { label: "Ativo", className: "bg-green-100 text-green-700" },
  PAUSED: { label: "Pausado", className: "bg-orange-100 text-orange-700" },
  COMPLETED: { label: "Concluído", className: "bg-blue-100 text-blue-700" },
  CANCELLED: { label: "Cancelado", className: "bg-red-100 text-red-700" },
};

const RECIPIENT_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendente", className: "bg-gray-100 text-gray-700" },
  SENT: { label: "Enviado", className: "bg-green-100 text-green-700" },
  FAILED: { label: "Falhou", className: "bg-red-100 text-red-700" },
  REPLIED: { label: "Respondeu", className: "bg-blue-100 text-blue-700" },
};

export default function CampaignViewPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const router = useRouter();
  const [page, setPage] = React.useState(1);

  const { data, loading, refetch } = useQuery(GET_CAMPAIGN, {
    variables: { id: campaignId },
    fetchPolicy: "cache-and-network",
  });

  const { data: recipientsData } = useQuery(GET_RECIPIENTS, {
    variables: { id: campaignId, page, pageSize: 50 },
    fetchPolicy: "cache-and-network",
  });

  const { data: replyData } = useQuery(GET_REPLY_RATE, {
    variables: { id: campaignId },
  });

  const [startCampaign, { loading: starting }] = useMutation(START_CAMPAIGN, {
    onCompleted: () => refetch(),
  });
  const [pauseCampaign, { loading: pausing }] = useMutation(PAUSE_CAMPAIGN, {
    onCompleted: () => refetch(),
  });

  const campaign = data?.getCampaign;
  const stats = data?.getCampaignStats;
  const recipients = recipientsData?.getCampaignRecipientsTable?.recipients ?? [];
  const recipientsTotal = recipientsData?.getCampaignRecipientsTable?.total ?? 0;
  const chartData = replyData?.campaignReplyRate ?? [];

  if (loading && !campaign) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campaign) return <div className="p-6">Campanha não encontrada</div>;

  const statusInfo = STATUS_CONFIG[campaign.status] ?? { label: campaign.status, className: "" };
  const progressPercent = campaign.totalRecipients > 0
    ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <button onClick={() => router.push("/crm/campaigns")} className="hover:text-foreground">
            Campanhas
          </button>
          <span>/</span>
          <span className="text-foreground font-medium">{campaign.name}</span>
        </nav>
      </div>

      {/* Campaign Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", statusInfo.className)}>
              {statusInfo.label}
            </span>
          </div>
          {campaign.scheduledAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Agendado para: {formatDateTime(campaign.scheduledAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" />
            Exportar
          </Button>
          <Button variant="outline" size="sm">
            <Copy className="w-4 h-4 mr-1.5" />
            Clonar
          </Button>
          <Button variant="outline" size="sm">
            <Edit2 className="w-4 h-4 mr-1.5" />
            Editar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* WhatsApp Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conta WhatsApp</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{campaign.sender?.accountName ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{campaign.sender?.displayPhoneNumber}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Estável</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full text-xs">
              <RefreshCw className="w-3 h-3 mr-1.5" />
              Atualizar Status
            </Button>
          </CardContent>
        </Card>

        {/* Progress */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Progresso do Envio</CardTitle>
              <div className="flex gap-1.5">
                {(campaign.status === "PLANNING" || campaign.status === "PAUSED") && (
                  <Button
                    size="sm"
                    onClick={() => startCampaign({ variables: { id: campaignId } })}
                    disabled={starting}
                    className="gap-1.5"
                  >
                    {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Iniciar
                  </Button>
                )}
                {campaign.status === "ACTIVE" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pauseCampaign({ variables: { id: campaignId } })}
                    disabled={pausing}
                    className="gap-1.5"
                  >
                    {pausing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                    Pausar
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl font-bold text-primary">{progressPercent}%</span>
              <div className="flex-1">
                <Progress value={progressPercent} className="h-3" />
                <p className="text-xs text-muted-foreground mt-1">
                  {campaign.sentCount} de {campaign.totalRecipients} enviados
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { label: "Enviados", value: stats?.sent ?? 0, color: "text-green-600" },
                { label: "Falhas", value: stats?.failed ?? 0, color: "text-red-600" },
                { label: "Responderam", value: stats?.replied ?? 0, color: "text-blue-600" },
              ].map((s) => (
                <div key={s.label} className="text-center p-2 bg-muted/40 rounded-lg">
                  <p className={cn("text-lg font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reply Rate Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Taxa de Resposta por Dia</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="sent" name="Enviados" fill="#004c3f" radius={[2, 2, 0, 0]} />
              <Bar dataKey="replied" name="Responderam" fill="#00ff87" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recipients Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Destinatários</CardTitle>
            <span className="text-xs text-muted-foreground">
              Mostrando {Math.min(recipients.length, 50)} de {recipientsTotal} registros
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Destinatário
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Enviado em
                  </th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r: { id: string; phoneNumber: string; name?: string; status: string; sentAt?: string }) => {
                  const statusInfo = RECIPIENT_STATUS[r.status] ?? { label: r.status, className: "" };
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.phoneNumber}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", statusInfo.className)}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.sentAt ? formatDateTime(r.sentAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {recipients.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Nenhum destinatário
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {recipientsTotal > 50 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page} de {Math.ceil(recipientsTotal / 50)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(recipientsTotal / 50)}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
