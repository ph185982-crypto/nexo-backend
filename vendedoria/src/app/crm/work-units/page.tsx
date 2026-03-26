"use client";

import React, { useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import { Building2, Plus, Search, MoreVertical, MapPin, Users, Loader2 } from "lucide-react";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const GET_UNITS = gql`
  query GetWorkUnits($organizationId: String!, $search: String) {
    listWorkUnits(organizationId: $organizationId, search: $search) {
      id name address timezone isActive professionalCount
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsUnits {
    whatsappBusinessOrganizations { id name }
  }
`;

const CREATE_UNIT = gql`
  mutation CreateWorkUnit($input: CreateWorkUnitInput!) {
    createWorkUnit(input: $input) { id name address isActive professionalCount }
  }
`;

const UPDATE_UNIT = gql`
  mutation UpdateWorkUnit($id: String!, $input: CreateWorkUnitInput!) {
    updateWorkUnit(id: $id, input: $input) { id name address isActive }
  }
`;

interface WorkUnit {
  id: string;
  name: string;
  address?: string;
  timezone: string;
  isActive: boolean;
  professionalCount: number;
}

export default function WorkUnitsPage() {
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<WorkUnit | null>(null);
  const [form, setForm] = useState({ name: "", address: "", timezone: "America/Sao_Paulo" });

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = orgsData?.whatsappBusinessOrganizations ?? [];
  const orgId = selectedOrgId || orgs[0]?.id || "";

  const { data, loading, refetch } = useQuery(GET_UNITS, {
    variables: { organizationId: orgId, search: search || undefined },
    skip: !orgId,
    fetchPolicy: "cache-and-network",
  });

  const [createUnit, { loading: creating }] = useMutation(CREATE_UNIT, {
    onCompleted: () => { setCreateOpen(false); refetch(); },
  });

  const [updateUnit, { loading: updating }] = useMutation(UPDATE_UNIT, {
    onCompleted: () => { setEditUnit(null); refetch(); },
  });

  const units: WorkUnit[] = data?.listWorkUnits ?? [];

  const handleCreate = async () => {
    if (!form.name) return;
    await createUnit({
      variables: { input: { ...form, organizationId: orgId } },
    });
    setForm({ name: "", address: "", timezone: "America/Sao_Paulo" });
  };

  const handleEdit = async () => {
    if (!editUnit) return;
    await updateUnit({
      variables: { id: editUnit.id, input: { ...form, organizationId: orgId } },
    });
  };

  const openEdit = (unit: WorkUnit) => {
    setEditUnit(unit);
    setForm({ name: unit.name, address: unit.address ?? "", timezone: unit.timezone });
  };

  const UnitFormContent = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Nome *</Label>
        <Input
          placeholder="Nome da unidade"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Endereço</Label>
        <Input
          placeholder="Rua, número, bairro..."
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Fuso Horário</Label>
        <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="America/Sao_Paulo">América/São Paulo</SelectItem>
            <SelectItem value="America/Manaus">América/Manaus</SelectItem>
            <SelectItem value="America/Belem">América/Belém</SelectItem>
            <SelectItem value="America/Fortaleza">América/Fortaleza</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Unidades de Trabalho</h1>
            <p className="text-xs text-muted-foreground">Gerencie as unidades da sua organização</p>
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
            Nova Unidade
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou endereço..."
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
      ) : units.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">Nenhuma unidade</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Crie a primeira unidade de trabalho
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {units.map((unit) => (
            <Card key={unit.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{unit.name}</p>
                    <Badge variant={unit.isActive ? "success" : "muted"} className="mt-1">
                      {unit.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(unit)}>Editar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-3 space-y-1.5">
                  {unit.address && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" />
                      {unit.address}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Users className="w-3 h-3" />
                    {unit.professionalCount} profissional{unit.professionalCount !== 1 ? "is" : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Unidade</DialogTitle>
          </DialogHeader>
          {UnitFormContent}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !form.name}>
              {creating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editUnit} onOpenChange={(v) => !v && setEditUnit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Unidade</DialogTitle>
          </DialogHeader>
          {UnitFormContent}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUnit(null)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={updating || !form.name}>
              {updating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
