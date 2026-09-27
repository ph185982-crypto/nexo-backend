// Cliente das rotas /api/prospeccao — tipos compartilhados e fetch com erro legível.

import type { EtapaId } from "@/lib/prospeccao/status";
import type { AbaId } from "./navegacao";

export interface Org { id: string; name: string }

export type ContagemEtapas = Record<EtapaId, number>;

export interface Busca {
  id: string;
  nome: string;
  termoBusca: string;
  termosSecundarios: string[];
  cidades: string[];
  apenasCelular: boolean;
  filtroSite: string;
  metaEmpresas: number;
  limiarScoreQualificado: number;
  pesoSemSite: number;
  pesoSemAnuncioAtivo: number;
  pesoInstagramParado: number;
  pesoRatingBaixo: number;
  createdAt: string;
  total: number;
  etapas: ContagemEtapas;
  porStatus: Record<string, number>;
  buscando: { inseridos: number; meta: number; iniciadoEm: string } | null;
}

export interface Passo {
  id: string;
  prioridade: number;
  titulo: string;
  descricao: string;
  acao: { label: string; aba: AbaId; segmentId?: string; executar?: "pipeline" | "sourcing" };
}

export interface Resumo {
  etapas: ContagemEtapas;
  porStatus: Record<string, number>;
  kpis: {
    total: number;
    aprovadas: number;
    abordados: number;
    responderam: number;
    qualificados: number;
    reunioes: number;
    taxaResposta: number;
    taxaReuniao: number;
  };
  buscas: Busca[];
  passos: Passo[];
  alertas: Array<{ tipo: "erro" | "aviso"; msg: string }>;
  disparo: { pausado: boolean; dentroJanela: boolean; janela: string; limiteDiario: number; template: string | null };
}

export interface EmpresaResumo {
  id: string;
  nome: string | null;
  telefone: string | null;
  tipoTelefone: string | null;
  enderecoCompleto: string | null;
  website: string | null;
  status: string;
  score: number | null;
  ratingGoogle: number | null;
  numeroAvaliacoes: number | null;
  temSite: boolean | null;
  temAnuncioAtivo: boolean | null;
  instagramAtivo: boolean | null;
  followersIG: number | null;
  analiseIA: string | null;
  motivoAnaliseIA: string | null;
  dataAbordagem: string | null;
  tentativasDisparo: number;
  createdAt: string;
  updatedAt: string;
  segment: { id: string; nome: string } | null;
}

export interface EmpresaDetalhe extends EmpresaResumo {
  notas: string | null;
  tipoNegocio: string | null;
  urgencia: string | null;
  sinalOportunidade: string | null;
  dataHoraReuniao: string | null;
  googleMeetLink: string | null;
  ultimaPostagemIG: string | null;
  templateUsado: { id: string; nomeTemplateMeta: string } | null;
  leadId: string | null;
  conversa: { id: string; lastMessageAt: string | null; humanTakeover: boolean } | null;
  scoreDetalhe: Array<{ sinal: string; pontos: number; aplicado: boolean }>;
  limiar: number;
}

export interface ResultadoPipeline {
  processados: number;
  erros: number;
  aprovados: number;
  revisao: number;
  descartados: number;
  restantes: { novo: number; enriquecido: number; pontuado: number; total: number };
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    ...(json !== undefined
      ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } }
      : {}),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string; erro?: string };
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error ?? data.erro ?? `Erro ${res.status}`);
  }
  return data;
}

export function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1).replace(".", ",")}%`;
}

export function fmtTelefone(t: string | null): string {
  if (!t) return "—";
  const d = t.replace(/\D/g, "");
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

export function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function linkSite(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`;
}
