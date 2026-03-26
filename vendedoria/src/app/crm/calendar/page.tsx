"use client";

import React, { useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  ChevronLeft, ChevronRight, Plus, LayoutGrid, List, RefreshCw,
  Calendar as CalendarIcon, Clock, MapPin, User, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn, formatDateTime } from "@/lib/utils";

const LIST_EVENTS = gql`
  query ListCalendarEvents($organizationId: String!, $month: Int!, $year: Int!) {
    listCalendarEvents(organizationId: $organizationId, month: $month, year: $year) {
      id title description startTime endTime status timezone
      profissionalId workUnitId googleMeetLink
      attendees { id name email status }
    }
  }
`;

const GET_CALENDAR_KPIS = gql`
  query CalendarKpis($organizationId: String!) {
    getCalendarKpis(organizationId: $organizationId) {
      scheduledToday scheduledWeek completed cancelled pending
    }
  }
`;

const GET_ORGS = gql`
  query GetOrgsCalendar {
    whatsappBusinessOrganizations { id name status }
  }
`;

const LIST_PROFESSIONALS = gql`
  query ListProfsCalendar($organizationId: String!) {
    listProfissionais(organizationId: $organizationId) { id name workField }
  }
`;

const LIST_WORK_UNITS = gql`
  query ListUnitsCalendar($organizationId: String!) {
    listWorkUnits(organizationId: $organizationId) { id name address }
  }
`;

const CREATE_EVENT = gql`
  mutation CreateCalendarEvent($input: CreateCalendarEventInput!) {
    createCalendarEvent(input: $input) {
      id title startTime endTime status
    }
  }
`;

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  status: string;
  profissionalId?: string;
  workUnitId?: string;
  googleMeetLink?: string;
  attendees?: Array<{ id: string; name: string; email?: string; status: string }>;
}

const DAYS_OF_WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function statusColor(status: string) {
  switch (status) {
    case "SCHEDULED": return "bg-blue-100 text-blue-700";
    case "COMPLETED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "SCHEDULED": return "Agendado";
    case "COMPLETED": return "Realizado";
    case "CANCELLED": return "Cancelado";
    default: return status;
  }
}

export default function CalendarPage() {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  // New event form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    startTime: "",
    endTime: "",
    profissionalId: "",
    workUnitId: "",
    saveToGoogle: false,
    generateMeet: false,
    sendWhatsapp: true,
    attendeeName: "",
    attendeePhone: "",
    attendeeEmail: "",
  });

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs = orgsData?.whatsappBusinessOrganizations ?? [];
  const orgId = selectedOrgId || orgs[0]?.id || "";

  const { data: eventsData, loading } = useQuery(LIST_EVENTS, {
    variables: { organizationId: orgId, month: currentMonth + 1, year: currentYear },
    skip: !orgId,
    fetchPolicy: "cache-and-network",
  });

  const { data: kpisData } = useQuery(GET_CALENDAR_KPIS, {
    variables: { organizationId: orgId },
    skip: !orgId,
  });

  const { data: profsData } = useQuery(LIST_PROFESSIONALS, {
    variables: { organizationId: orgId },
    skip: !orgId,
  });

  const { data: unitsData } = useQuery(LIST_WORK_UNITS, {
    variables: { organizationId: orgId },
    skip: !orgId,
  });

  const [createEvent, { loading: creating }] = useMutation(CREATE_EVENT, {
    refetchQueries: [{ query: LIST_EVENTS, variables: { organizationId: orgId, month: currentMonth + 1, year: currentYear } }],
  });

  const events: CalendarEvent[] = eventsData?.listCalendarEvents ?? [];
  const kpis = kpisData?.getCalendarKpis;
  const professionals = profsData?.listProfissionais ?? [];
  const workUnits = unitsData?.listWorkUnits ?? [];

  // Build calendar grid
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const calendarDays: Array<{ day: number | null; events: CalendarEvent[] }> = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push({ day: null, events: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const dayEvents = events.filter((e) => {
      const eventDate = new Date(e.startTime);
      return (
        eventDate.getDate() === d &&
        eventDate.getMonth() === currentMonth &&
        eventDate.getFullYear() === currentYear
      );
    });
    calendarDays.push({ day: d, events: dayEvents });
  }

  const handleCreateEvent = async () => {
    if (!formData.title || !formData.startTime) return;
    await createEvent({
      variables: {
        input: {
          title: formData.title,
          description: formData.description || undefined,
          startTime: formData.startTime,
          endTime: formData.endTime || formData.startTime,
          organizationId: orgId,
          profissionalId: formData.profissionalId || undefined,
          workUnitId: formData.workUnitId || undefined,
          saveToGoogle: formData.saveToGoogle,
          generateMeet: formData.generateMeet,
          sendWhatsappNotification: formData.sendWhatsapp,
        },
      },
    });
    setNewEventOpen(false);
    setFormData({ ...formData, title: "", description: "", startTime: "", endTime: "" });
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus agendamentos</p>
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
          <Button onClick={() => setNewEventOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Agendamento
          </Button>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Hoje", value: kpis.scheduledToday, color: "#3b82f6" },
            { label: "Esta Semana", value: kpis.scheduledWeek, color: "#8b5cf6" },
            { label: "Pendentes", value: kpis.pending, color: "#f97316" },
            { label: "Realizados", value: kpis.completed, color: "#22c55e" },
            { label: "Cancelados", value: kpis.cancelled, color: "#ef4444" },
          ].map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Calendar Navigation */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={prevMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {MONTHS[currentMonth]} {currentYear}
              </h2>
              <Button variant="outline" size="icon-sm" onClick={nextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); }}
                className="text-xs"
              >
                Hoje
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={view === "grid" ? "default" : "ghost"}
                size="icon-sm"
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={view === "list" ? "default" : "ghost"}
                size="icon-sm"
                onClick={() => setView("list")}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {view === "grid" ? (
            // Grid View
            <div>
              <div className="grid grid-cols-7 mb-2">
                {DAYS_OF_WEEK.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-gray-200">
                {calendarDays.map((cell, i) => {
                  const isToday =
                    cell.day === today.getDate() &&
                    currentMonth === today.getMonth() &&
                    currentYear === today.getFullYear();
                  return (
                    <div
                      key={i}
                      className={cn(
                        "bg-white min-h-[80px] p-1.5",
                        !cell.day && "bg-gray-50"
                      )}
                    >
                      {cell.day && (
                        <>
                          <span
                            className={cn(
                              "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
                              isToday ? "bg-primary text-white" : "text-foreground"
                            )}
                          >
                            {cell.day}
                          </span>
                          <div className="space-y-0.5 mt-1">
                            {cell.events.slice(0, 2).map((evt) => (
                              <div
                                key={evt.id}
                                className={cn(
                                  "text-xs px-1.5 py-0.5 rounded truncate cursor-pointer",
                                  statusColor(evt.status)
                                )}
                              >
                                {evt.title}
                              </div>
                            ))}
                            {cell.events.length > 2 && (
                              <p className="text-xs text-muted-foreground pl-1">
                                +{cell.events.length - 2}
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // List View
            <div className="space-y-2">
              {events.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  Nenhum evento neste mês
                </p>
              ) : (
                events.map((evt) => (
                  <div
                    key={evt.id}
                    className="flex items-center gap-4 p-3 border border-border rounded-lg hover:bg-muted/50"
                  >
                    <div className="text-center min-w-[60px]">
                      <p className="text-xs text-muted-foreground">
                        {new Date(evt.startTime).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </p>
                      <p className="text-sm font-semibold">
                        {new Date(evt.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{evt.title}</p>
                      {evt.description && (
                        <p className="text-xs text-muted-foreground truncate">{evt.description}</p>
                      )}
                    </div>
                    <Badge className={cn("text-xs", statusColor(evt.status))}>
                      {statusLabel(evt.status)}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Event Modal */}
      <Dialog open={newEventOpen} onOpenChange={setNewEventOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Agendamento</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Attendee */}
            <div className="space-y-3 p-3 bg-muted/40 rounded-lg">
              <h3 className="text-sm font-semibold">Cliente</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome Completo</Label>
                  <Input
                    placeholder="Nome do cliente"
                    value={formData.attendeeName}
                    onChange={(e) => setFormData({ ...formData, attendeeName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input
                    placeholder="+55 (11) 99999-9999"
                    value={formData.attendeePhone}
                    onChange={(e) => setFormData({ ...formData, attendeePhone: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>E-mail (opcional)</Label>
                  <Input
                    type="email"
                    placeholder="cliente@email.com"
                    value={formData.attendeeEmail}
                    onChange={(e) => setFormData({ ...formData, attendeeEmail: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Event Details */}
            <div className="space-y-1.5">
              <Label>Título do Agendamento *</Label>
              <Input
                placeholder="Ex: Consulta médica"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data e Hora de Início *</Label>
                <Input
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data e Hora de Término</Label>
                <Input
                  type="datetime-local"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unidade</Label>
                <Select value={formData.workUnitId} onValueChange={(v) => setFormData({ ...formData, workUnitId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {workUnits.map((u: { id: string; name: string }) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Profissional</Label>
                <Select value={formData.profissionalId} onValueChange={(v) => setFormData({ ...formData, profissionalId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {professionals.map((p: { id: string; name: string }) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Observações Internas</Label>
              <Textarea
                placeholder="Notas internas..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>

            {/* Options */}
            <div className="space-y-3 p-3 bg-muted/40 rounded-lg">
              <h3 className="text-sm font-semibold">Opções Adicionais</h3>
              {[
                { label: "Salvar na agenda do Google", key: "saveToGoogle" },
                { label: "Gerar link do Google Meet", key: "generateMeet" },
                { label: "Enviar notificação no WhatsApp", key: "sendWhatsapp" },
              ].map((opt) => (
                <div key={opt.key} className="flex items-center justify-between">
                  <Label className="text-sm font-normal">{opt.label}</Label>
                  <Switch
                    checked={formData[opt.key as keyof typeof formData] as boolean}
                    onCheckedChange={(v) => setFormData({ ...formData, [opt.key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewEventOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateEvent}
              disabled={creating || !formData.title || !formData.startTime}
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Agendamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
