"use client";

// Painel lateral com tudo sobre uma empresa: contato, sinais, score explicado,
// análise da IA, abordagem, notas e ações.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, Phone, Smartphone, MapPin, Globe, Star, Instagram, CheckCircle2, XCircle,
  RotateCcw, ClipboardCheck, MessageCircle, Loader2, Brain, Send, Calendar, Save,
} from "lucide-react";
import { ACOES_MANUAIS, type AcaoManual } from "@/lib/prospeccao/status";
import { api, fmtData, fmtTelefone, linkSite, type EmpresaDetalhe } from "./api";
import { Carregando, Sinal, StatusBadge, btn, inputCls, useAviso } from "./ui";

const BOTOES: Array<{ acao: AcaoManual; label: string; icon: React.ReactNode; cls: string }> = [
  { acao: "aprovar",     label: "Aprovar",        icon: <CheckCircle2 className="w-4 h-4" />, cls: btn.sucesso },
  { acao: "descartar",   label: "Descartar",      icon: <XCircle className="w-4 h-4" />, cls: btn.perigo },
  { acao: "revisar",     label: "Enviar p/ revisão", icon: <ClipboardCheck className="w-4 h-4" />, cls: btn.secundario },
  { acao: "reprocessar", label: "Requalificar",   icon: <RotateCcw className="w-4 h-4" />, cls: btn.secundario },
  { acao: "perdido",     label: "Marcar perdida", icon: <XCircle className="w-4 h-4" />, cls: btn.secundario },
];

export function LeadDrawer({ id, onClose, onMudou }: { id: string; onClose: () => void; onMudou: () => void }) {
  const avisar = useAviso();
  const [e, setE] = useState<EmpresaDetalhe | null>(null);
  const [notas, setNotas] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = async () => {
    try {
      const d = await api<EmpresaDetalhe>(`/api/prospeccao/empresas/${id}`);
      setE(d);
      setNotas(d.notas ?? "");
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
      onClose();
    }
  };

  useEffect(() => {
    setE(null);
    void carregar();
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patch = async (corpo: { acao?: AcaoManual; notas?: string }, chave: string) => {
    setSalvando(chave);
    try {
      await api(`/api/prospeccao/empresas/${id}`, { method: "PATCH", json: corpo });
      avisar(corpo.acao ? "Status atualizado." : "Notas salvas.");
      await carregar();
      onMudou();
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
    } finally {
      setSalvando(null);
    }
  };

  const botoes = e ? BOTOES.filter((b) => (ACOES_MANUAIS[b.acao].de as readonly string[]).includes(e.status)) : [];
  const scoreTotal = e?.scoreDetalhe.filter((s) => s.aplicado).reduce((a, s) => a + s.pontos, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes da empresa"
        className="w-full sm:max-w-md h-full bg-card border-l border-border shadow-xl flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start gap-2 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{e?.nome ?? "Carregando…"}</h2>
            {e && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusBadge status={e.status} />
                {e.segment && <span className="text-xs text-muted-foreground truncate">{e.segment.nome}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        {!e ? <Carregando /> : (
          <div className="flex-1 overflow-auto px-5 py-4 space-y-5 text-sm">
            {/* Contato */}
            <section className="space-y-2">
              <Linha icon={e.tipoTelefone === "CELULAR" ? <Smartphone className="w-4 h-4 text-green-500" /> : <Phone className="w-4 h-4" />}>
                {fmtTelefone(e.telefone)}
                <span className="ml-2 text-xs text-muted-foreground">{e.tipoTelefone === "CELULAR" ? "WhatsApp" : e.tipoTelefone === "FIXO" ? "Fixo — não recebe WhatsApp" : ""}</span>
              </Linha>
              {e.enderecoCompleto && <Linha icon={<MapPin className="w-4 h-4" />}>{e.enderecoCompleto}</Linha>}
              {e.website && (
                <Linha icon={<Globe className="w-4 h-4" />}>
                  <a href={linkSite(e.website)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                    {e.website.replace(/^https?:\/\//, "")}
                  </a>
                </Linha>
              )}
              {e.ratingGoogle != null && (
                <Linha icon={<Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}>
                  {e.ratingGoogle.toFixed(1)} no Google ({e.numeroAvaliacoes ?? 0} avaliações)
                </Linha>
              )}
              {e.followersIG != null && (
                <Linha icon={<Instagram className="w-4 h-4" />}>
                  {e.followersIG.toLocaleString("pt-BR")} seguidores
                  {e.ultimaPostagemIG && <span className="text-xs text-muted-foreground"> · último post {fmtData(e.ultimaPostagemIG)}</span>}
                </Linha>
              )}
            </section>

            {/* Conversa */}
            {e.conversa && (
              <Link
                href={`/crm/conversations?id=${e.conversa.id}`}
                className={`${btn.secundario} w-full`}
              >
                <MessageCircle className="w-4 h-4" /> Abrir conversa no WhatsApp
                {e.conversa.lastMessageAt && <span className="text-xs text-muted-foreground">· {fmtData(e.conversa.lastMessageAt)}</span>}
              </Link>
            )}

            {/* Sinais + score */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sinais digitais</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Sinal value={e.temSite} label="Site" />
                <Sinal value={e.temAnuncioAtivo} label="Anúncio ativo" />
                <Sinal value={e.instagramAtivo} label="Instagram ativo" />
              </div>
              {e.score !== null ? (
                <div className="rounded-lg border border-border">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <span className="text-xs font-medium text-foreground">Score de oportunidade</span>
                    <span className="text-sm font-bold text-foreground">{e.score} <span className="text-xs font-normal text-muted-foreground">/ mínimo {e.limiar}</span></span>
                  </div>
                  <ul className="px-3 py-2 space-y-1">
                    {e.scoreDetalhe.map((s) => (
                      <li key={s.sinal} className={`flex justify-between text-xs ${s.aplicado ? "text-foreground" : "text-muted-foreground/60 line-through"}`}>
                        <span>{s.sinal}</span><span>+{s.pontos}</span>
                      </li>
                    ))}
                  </ul>
                  {scoreTotal !== e.score && (
                    <p className="px-3 pb-2 text-[11px] text-muted-foreground">Os pesos da busca mudaram depois do cálculo — requalifique para atualizar.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Ainda não qualificada.</p>
              )}
            </section>

            {/* IA */}
            {e.motivoAnaliseIA && (
              <section className="rounded-lg bg-muted/50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1">
                  <Brain className="w-3.5 h-3.5 text-primary" /> Análise da IA {e.analiseIA && <span className="font-normal text-muted-foreground">· {e.analiseIA}</span>}
                </div>
                <p className="text-xs text-muted-foreground">{e.motivoAnaliseIA}</p>
              </section>
            )}

            {/* Abordagem */}
            {(e.dataAbordagem || e.tentativasDisparo > 0 || e.dataHoraReuniao) && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abordagem</h3>
                {e.dataAbordagem && (
                  <Linha icon={<Send className="w-4 h-4" />}>
                    Abordada em {fmtData(e.dataAbordagem)}
                    {e.templateUsado && <span className="text-xs text-muted-foreground"> · {e.templateUsado.nomeTemplateMeta}</span>}
                  </Linha>
                )}
                {e.tentativasDisparo > 0 && <p className="text-xs text-muted-foreground">{e.tentativasDisparo} tentativa(s) de envio</p>}
                {e.dataHoraReuniao && (
                  <Linha icon={<Calendar className="w-4 h-4" />}>
                    Reunião {fmtData(e.dataHoraReuniao)}
                    {e.googleMeetLink && <a href={e.googleMeetLink} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline">Meet</a>}
                  </Linha>
                )}
                {e.sinalOportunidade && <p className="text-xs text-muted-foreground">Oportunidade: {e.sinalOportunidade}</p>}
              </section>
            )}

            {/* Notas */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notas</h3>
              <textarea
                value={notas}
                onChange={(ev) => setNotas(ev.target.value)}
                rows={3}
                placeholder="Anotações sobre esta empresa…"
                className={`${inputCls} resize-y`}
              />
              {notas !== (e.notas ?? "") && (
                <button onClick={() => void patch({ notas }, "notas")} disabled={!!salvando} className={btn.secundario}>
                  {salvando === "notas" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar notas
                </button>
              )}
            </section>

            <p className="text-[11px] text-muted-foreground">
              Encontrada em {fmtData(e.createdAt)} · atualizada em {fmtData(e.updatedAt)}
            </p>
          </div>
        )}

        {e && botoes.length > 0 && (
          <div className="px-5 py-3 border-t border-border grid grid-cols-2 gap-2">
            {botoes.map((b) => (
              <button key={b.acao} onClick={() => void patch({ acao: b.acao }, b.acao)} disabled={!!salvando} className={b.cls}>
                {salvando === b.acao ? <Loader2 className="w-4 h-4 animate-spin" /> : b.icon} {b.label}
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Linha({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-foreground">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
