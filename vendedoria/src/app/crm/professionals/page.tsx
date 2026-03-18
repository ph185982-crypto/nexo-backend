"use client";

import React, { useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  Users, Plus, Search, MoreVertical, Calendar, Info, Edit2, Loader2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, getInitials, getAvatarColor } from "@/lib/utils";

const GET_PROFS = gql`
  query GetProfissionais($organizationId: String!, $search: String) {
    listProfissionais(organizationId: $organizationId, search: $search) {
      id name description workField imageUrl isActive loginEmail workUnitCount
      availabilities {
        id dayOfWeek startTime endTime breakMinutes isActive
      }
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsProfs {
    whatsappBusinessOrganizations { id name }
  }
`;

const CREATE_PROF = gql`
  mutation CreateProf($input: CreateProfissionalInput!) {
    createProfissional(input: $input) {
      id name workField isActive workUnitCount
    }
  }
`;

const DAYS_OF_WEEK = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface Availability {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
}

interface Professional {
  id: string;
  name: string;
  description?: string;
  workField?: string;
  isActive: boolean;
  loginEmail?: string;
  workUnitCount: number;
  availabilities?: Availability[];
}

function ProfessionalCard({
  prof,
  onSelect,
}: {
  prof: Professional;
  onSelect: () => void;
}) {
  const initials = getInitials(prof.name);
  const color = getAvatarColor(prof.name);

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={onSelect}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12 flex-shrink-0">
            <AvatarFallback
              className="text-white font-semibold"
              style={{ backgroundColor: color }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{prof.name}</p>
                {prof.workField && (
                  <p className="text-sm text-muted-foreground">{prof.workField}</p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Editar Cadastro</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {prof.workUnitCount} Unidade{prof.workUnitCount !== 1 ? "s" : ""}
              </span>
              <Badge variant={prof.isActive ? "success" : "muted"}>
                {prof.isActive ? "Ativo" : "Inativo"}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfessionalDetailModal({
  prof,
  open,
  onClose,
}: {
  prof: Professional | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!prof) return null;

  const initials = getInitials(prof.name);
  const color = getAvatarColor(prof.name);

  const availabilities = prof.availabilities ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              <AvatarFallback
                className="text-white font-semibold"
                style={{ backgroundColor: color }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle>{prof.name}</DialogTitle>
              {prof.workField && (
                <p className="text-sm text-muted-foreground">{prof.workField}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="schedules">
          <TabsList className="w-full">
            <TabsTrigger value="schedules" className="flex-1 gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Escalas
            </TabsTrigger>
            <TabsTrigger value="details" className="flex-1 gap-1.5">
              <Info className="w-3.5 h-3.5" />
              Detalhes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedules" className="mt-4">
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((day) => {
                const avail = availabilities.find((a) => a.dayOfWeek === day);
                return (
                  <div
                    key={day}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-lg border",
                      avail?.isActive ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"
                    )}
                  >
                    <span className="text-sm font-medium w-20">{DAYS_SHORT[day]}</span>
                    {avail?.isActive ? (
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-green-700">
                          {avail.startTime} – {avail.endTime}
                        </span>
                        {avail.breakMinutes > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {avail.breakMinutes}min intervalo
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Não disponível</span>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="details" className="mt-4 space-y-3">
            {prof.description && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  DESCRIÇÃO
                </p>
                <p className="text-sm">{prof.description}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                ID DO SISTEMA
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{prof.id}</code>
            </div>
            {prof.loginEmail && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  EMAIL
                </p>
                <p className="text-sm">{prof.loginEmail}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" className="gap-1.5">
            <Edit2 className="w-4 h-4" />
            Editar Cadastro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfessionalsPage() {
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProf, setSelectedProf] = useState<Professional | null>(null);
  const [form, setForm] = useState({ name: "", workField: "", description: "", loginEmail: "", isActive: true });

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = orgsData?.whatsappBusinessOrganizations ?? [];
  const orgId = selectedOrgId || orgs[0]?.id || "";

  const { data, loading, refetch } = useQuery(GET_PROFS, {
    variables: { organizationId: orgId, search: search || undefined },
    skip: !orgId,
    fetchPolicy: "cache-and-network",
  });

  const [createProf, { loading: creating }] = useMutation(CREATE_PROF, {
    onCompleted: () => { setCreateOpen(false); refetch(); },
  });

  const professionals: Professional[] = data?.listProfissionais ?? [];

  const handleCreate = async () => {
    if (!form.name) return;
    await createProf({
      variables: {
        input: {
          ...form,
          organizationId: orgId,
          availabilities: [1, 2, 3, 4, 5].map((day) => ({
            dayOfWeek: day,
            startTime: "08:00",
            endTime: "18:00",
            breakMinutes: 45,
          })),
        },
      },
    });
    setForm({ name: "", workField: "", description: "", loginEmail: "", isActive: true });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Profissionais</h1>
            <p className="text-xs text-muted-foreground">Gerencie os profissionais da organização</p>
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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Profissional
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou especialidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : professionals.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">Nenhum profissional</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Adicione o primeiro profissional
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {professionals.map((prof) => (
            <ProfessionalCard
              key={prof.id}
              prof={prof}
              onSelect={() => setSelectedProf(prof)}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Profissional</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                placeholder="Nome completo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cargo / Especialidade</Label>
              <Input
                placeholder="Ex: Dentista, Médico Clínico Geral..."
                value={form.workField}
                onChange={(e) => setForm({ ...form, workField: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email de Login</Label>
              <Input
                type="email"
                placeholder="profissional@email.com"
                value={form.loginEmail}
                onChange={(e) => setForm({ ...form, loginEmail: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !form.name}>
              {creating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <ProfessionalDetailModal
        prof={selectedProf}
        open={!!selectedProf}
        onClose={() => setSelectedProf(null)}
      />
    </div>
  );
}
