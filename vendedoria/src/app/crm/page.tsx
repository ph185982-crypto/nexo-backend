"use client";

import React, { useState } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  DollarSign, TrendingUp, Users, MessageSquare,
  FileText, RefreshCw, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const WIDGETS_QUERY = gql`
  query WidgetsData($timeFilter: String, $whatsappProviderConfigId: String) {
    widgetsData(timeFilter: $timeFilter, whatsappProviderConfigId: $whatsappProviderConfigId) {
      uniqueWhatsappConversations
      leadsQuentes
      conversationWindowsOpened
      repassados
      contactsSentDocs
      regionStatistics { region count }
    }
  }
`;

const ACCOUNTS_QUERY = gql`
  query AllAccounts {
    whatsappBusinessOrganizations {
      id
      name
      accounts {
        id
        accountName
        displayPhoneNumber
      }
    }
  }
`;

const TIME_FILTERS = [
  { label: "Todas", value: "all" },
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "15 dias", value: "15d" },
  { label: "30 dias", value: "30d" },
];

interface MetricCardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  description?: string;
}

function MetricCard({ title, value, icon: Icon, color, description }: MetricCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight" style={{ color }}>
              {value.toLocaleString("pt-BR")}
            </p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon className="w-6 h-6" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [timeFilter, setTimeFilter] = useState("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");

  const { data: orgsData } = useQuery(ACCOUNTS_QUERY);
  const { data, loading, refetch } = useQuery(WIDGETS_QUERY, {
    variables: {
      timeFilter: timeFilter === "all" ? undefined : timeFilter,
      whatsappProviderConfigId: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined,
    },
    fetchPolicy: "cache-and-network",
  });

  const metrics = data?.widgetsData;
  const allAccounts = (orgsData?.whatsappBusinessOrganizations ?? []).flatMap(
    (org: { id: string; name: string; accounts: Array<{ id: string; accountName: string; displayPhoneNumber: string }> }) =>
      org.accounts.map((acc: { id: string; accountName: string; displayPhoneNumber: string }) => ({
        ...acc,
        orgName: org.name,
      }))
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral do seu CRM
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Account selector */}
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-48 bg-white">
              <SelectValue placeholder="Conta WhatsApp" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {allAccounts.map((acc: { id: string; accountName: string; displayPhoneNumber: string }) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.accountName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Time filter */}
          <div className="flex bg-white border border-border rounded-md overflow-hidden">
            {TIME_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTimeFilter(f.value)}
                className={cn(
                  "px-3 py-2 text-sm transition-colors",
                  timeFilter === f.value
                    ? "bg-primary text-white font-medium"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={loading}
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Número de Leads"
          value={metrics?.uniqueWhatsappConversations ?? 0}
          icon={DollarSign}
          color="#004c3f"
          description="Total de conversas únicas"
        />
        <MetricCard
          title="Leads que Enviaram Documentos"
          value={metrics?.contactsSentDocs ?? 0}
          icon={FileText}
          color="#0891b2"
          description="Documentos recebidos"
        />
        <MetricCard
          title="Leads Quentes"
          value={metrics?.leadsQuentes ?? 0}
          icon={TrendingUp}
          color="#f97316"
          description="Leads com alto potencial"
        />
        <MetricCard
          title="Leads Repassados"
          value={metrics?.repassados ?? 0}
          icon={Users}
          color="#8b5cf6"
          description="Escalados para vendedor humano"
        />
        <MetricCard
          title="Conversas Iniciadas"
          value={metrics?.conversationWindowsOpened ?? 0}
          icon={MessageSquare}
          color="#22c55e"
          description="Janelas de conversa abertas"
        />
      </div>

      {/* Region Statistics */}
      {metrics?.regionStatistics && metrics.regionStatistics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estatísticas por Região</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {metrics.regionStatistics.map((stat: { region: string; count: number }) => (
                <div key={stat.region} className="flex items-center gap-3">
                  <span className="text-sm w-32 text-muted-foreground">{stat.region}</span>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${(stat.count / Math.max(...metrics.regionStatistics.map((s: { count: number }) => s.count))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium w-12 text-right">{stat.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !metrics && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            Nenhum dado disponível
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure uma conta WhatsApp para começar a ver métricas
          </p>
        </div>
      )}
    </div>
  );
}
