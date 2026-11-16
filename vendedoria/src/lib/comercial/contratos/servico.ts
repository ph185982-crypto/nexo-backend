// Contratos do Comercial: gravar o contrato gerado no navegador, enviar para a ClickSign, reenviar, cancelar,
// reconciliar o status e guardar o PDF assinado. Assinado → automação (automacao.ts), uma vez só.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import * as cs from "./clicksign";
import {
  camposDoForm, camposFaltando, nomeArquivo, normalizarForm, statusDoEnvelope, telefoneNacional,
  STATUS_EM_ABERTO, type FormContrato, type StatusContrato,
} from "./modelo";

export class ErroContrato extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Contratada que assina todos os contratos (nome no envelope). O e-mail vem da tela ou de CONTRATOS_EMAIL_CONTRATADA. */
export const REPRESENTANTE_CONTRATADA = "Pedro Henrique Martins da Silva";
/** E-mail que assina pela contratada (o mesmo padrão do app Contratos antigo); CONTRATOS_EMAIL_CONTRATADA troca. */
export const emailContratadaPadrao = () => process.env.CONTRATOS_EMAIL_CONTRATADA?.trim() || "ph185982@gmail.com";
const MAX_PDF = 8 * 1024 * 1024;

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

function lerPdf(base64: string): Buffer {
  const limpo = String(base64 || "").replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  const buf = Buffer.from(limpo, "base64");
  if (buf.length < 100 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ErroContrato("O arquivo enviado não é um PDF");
  if (buf.length > MAX_PDF) throw new ErroContrato("PDF grande demais (máximo 8 MB)");
  return buf;
}

async function registrarEvento(contratoId: string | null, tipo: string, payload: unknown, o: { envelopeId?: string | null; externo?: string | null } = {}) {
  await prisma.contratoEvento.create({
    data: { contratoId, tipo, envelopeId: o.envelopeId ?? null, eventoExternoId: o.externo ?? null, payload: (payload ?? {}) as Prisma.InputJsonValue },
  });
}

// ── Vínculos ────────────────────────────────────────────────────────────────

async function resolverVinculos(v: { oportunidadeId?: string | null; contatoId?: string | null; leadId?: string | null }) {
  const oportunidadeId = v.oportunidadeId ?? null;
  let contatoId = v.contatoId ?? null, leadId = v.leadId ?? null;
  if (oportunidadeId) {
    const op = await prisma.comOportunidade.findUnique({ where: { id: oportunidadeId }, select: { contatoId: true, leadId: true } });
    if (!op) throw new ErroContrato("Oportunidade não encontrada", 404);
    contatoId = contatoId ?? op.contatoId;
    leadId = leadId ?? op.leadId;
  }
  if (contatoId) {
    const c = await prisma.comContato.findUnique({ where: { id: contatoId }, select: { leadId: true } });
    if (!c) throw new ErroContrato("Contato não encontrado", 404);
    leadId = leadId ?? c.leadId;
  }
  return { oportunidadeId, contatoId, leadId };
}

/** Formulário pré-preenchido a partir da oportunidade (e do contato/pessoa/lead ligados). */
export async function preencherDaOportunidade(oportunidadeId: string): Promise<Partial<FormContrato> & { oportunidadeId: string; contatoId: string; oportunidadeNome: string }> {
  const op = await prisma.comOportunidade.findUnique({
    where: { id: oportunidadeId },
    select: {
      id: true, nome: true, valorMensal: true, contatoId: true,
      contato: { select: { nome: true, tipo: true, documento: true, email: true, telefone: true, lead: { select: { empresa: true } } } },
      pessoa: { select: { nome: true, email: true, telefone: true } },
      lead: { select: { profileName: true, empresa: true, phoneNumber: true } },
    },
  });
  if (!op) throw new ErroContrato("Oportunidade não encontrada", 404);
  const c = op.contato;
  const doc = (c.documento ?? "").replace(/\D/g, "");
  const cnpj = doc.length === 14 ? `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}` : "";
  const empresa = c.tipo === "EMPRESA" ? c.nome : (op.lead?.empresa ?? c.lead?.empresa ?? c.nome);
  const tel = op.pessoa?.telefone ?? c.telefone ?? op.lead?.phoneNumber ?? "";
  const mensal = Number(op.valorMensal ?? 0);
  return {
    oportunidadeId: op.id, contatoId: op.contatoId, oportunidadeNome: op.nome,
    cnpj, razao: empresa ?? "", fantasia: c.tipo === "EMPRESA" ? c.nome : "",
    rep: op.pessoa?.nome ?? (c.tipo === "PESSOA" ? c.nome : op.lead?.profileName ?? ""),
    email: op.pessoa?.email ?? c.email ?? "", whats: tel ? telefoneNacional(tel) : "",
    ...(mensal > 0 ? { preco: mensal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } : {}),
  };
}

// ── Criar ───────────────────────────────────────────────────────────────────

export interface NovoContrato {
  form: unknown;
  base64Pdf?: string | null;
  oportunidadeId?: string | null;
  contatoId?: string | null;
  leadId?: string | null;
  substituiId?: string | null;
  uid?: string | null;
}

export async function criarContrato(n: NovoContrato) {
  const form = normalizarForm(n.form);
  const falta = camposFaltando(form);
  if (falta.length) throw new ErroContrato(`Faltam: ${falta.join(", ")}`);
  const pdf = n.base64Pdf ? lerPdf(n.base64Pdf) : null;
  if (n.substituiId && !(await prisma.contratoEmitido.findUnique({ where: { id: n.substituiId }, select: { id: true } }))) throw new ErroContrato("Versão anterior não encontrada", 404);
  const v = await resolverVinculos(n);
  const filename = nomeArquivo(form);
  return prisma.contratoEmitido.create({
    data: {
      ...camposDoForm(form), ...v, filename, formJson: form as unknown as Prisma.InputJsonValue,
      substituiId: n.substituiId ?? null, criadoPorId: n.uid ?? null, origem: "APP",
      ...(pdf ? { arquivos: { create: { tipo: "ORIGINAL", nome: filename, bytes: pdf, sha256: sha256(pdf) } } } : {}),
    },
  });
}

/** Anexa (ou troca) o PDF original de um contrato ainda não enviado (ex.: "Gerar de novo" de um importado). */
export async function anexarPdf(id: string, base64Pdf: string) {
  const c = await prisma.contratoEmitido.findUnique({ where: { id }, select: { status: true, filename: true, provedor: true } });
  if (!c) throw new ErroContrato("Contrato não encontrado", 404);
  if (c.provedor !== "clicksign" || !["GERADO", "ERRO"].includes(c.status)) throw new ErroContrato("Só dá para trocar o PDF de um contrato ainda não enviado", 409);
  const pdf = lerPdf(base64Pdf);
  await prisma.contratoArquivo.upsert({
    where: { contratoId_tipo: { contratoId: id, tipo: "ORIGINAL" } },
    create: { contratoId: id, tipo: "ORIGINAL", nome: c.filename, bytes: pdf, sha256: sha256(pdf) },
    update: { bytes: pdf, sha256: sha256(pdf), criadoEm: new Date() },
  });
}

// ── Enviar, reenviar, cancelar ──────────────────────────────────────────────

export interface OpcoesEnvio { canal?: "email" | "whatsapp"; emailContratada?: string | null; cancelarAnterior?: boolean }

export async function enviarContrato(id: string, o: OpcoesEnvio = {}, uid?: string | null) {
  const c = await prisma.contratoEmitido.findUnique({ where: { id }, include: { arquivos: { where: { tipo: "ORIGINAL" } } } });
  if (!c) throw new ErroContrato("Contrato não encontrado", 404);
  if (c.provedor !== "clicksign") throw new ErroContrato("Contrato importado do ZapSign: só leitura", 409);
  if (!["GERADO", "ERRO"].includes(c.status) || c.envelopeId) throw new ErroContrato("Este contrato já foi enviado", 409);
  const pdf = c.arquivos[0];
  if (!pdf) throw new ErroContrato("Contrato sem PDF: gere de novo antes de enviar", 409);
  if (!cs.clickSignConfigurada()) throw new ErroContrato("ClickSign não configurada no servidor (CLICKSIGN_TOKEN)", 503);
  const canal = o.canal === "whatsapp" ? "whatsapp" : "email";
  const tel = telefoneNacional(c.telefoneCliente);
  const temTel = tel.length >= 10;
  if (!temTel && !c.emailCliente) throw new ErroContrato("Preencha WhatsApp ou e-mail do cliente para enviar");
  if (canal === "whatsapp" && !temTel) throw new ErroContrato("Para enviar por WhatsApp, preencha o WhatsApp do cliente");
  if (canal === "email" && !c.emailCliente) throw new ErroContrato("Para enviar por e-mail, preencha o e-mail do cliente");

  // Reivindica o envio (dois cliques não criam dois envelopes).
  const claim = await prisma.contratoEmitido.updateMany({ where: { id, status: { in: ["GERADO", "ERRO"] }, envelopeId: null }, data: { status: "ENVIADO", ultimoErro: null } });
  if (claim.count === 0) throw new ErroContrato("Este contrato já está sendo enviado", 409);

  const emailContratada = (o.emailContratada ?? emailContratadaPadrao()).trim();
  const signers: cs.Signatario[] = [{ name: c.representante || c.razaoSocial, email: c.emailCliente, phone: temTel ? tel : null, channel: canal }];
  if (emailContratada) signers.push({ name: REPRESENTANTE_CONTRATADA, email: emailContratada, channel: "email" });
  const marca = c.marca === "nexo" ? "Nexo Consultoria & Growth" : "Avanteza Consultoria e Estratégia";
  const pasta = ["01 - CLIENTES", (c.razaoSocial || "Sem nome").toUpperCase()];
  try {
    const r = await cs.criarEnvelope({
      name: c.filename.replace(/\.pdf$/i, ""), filename: c.filename, base64Pdf: Buffer.from(pdf.bytes).toString("base64"),
      subject: `Contrato ${marca} · ${c.razaoSocial}`.slice(0, 100), folder: pasta, signers,
    });
    const atualizado = await prisma.contratoEmitido.update({
      where: { id }, data: { envelopeId: r.envelopeId, documentoId: r.documentoId, pastaClicksign: `/${pasta.join("/")}/`, enviadoEm: new Date() },
    });
    await registrarEvento(id, "ENVIADO", { canal, signatarios: r.signatarios, notificado: r.notificado, aviso: r.aviso, por: uid ?? null }, { envelopeId: r.envelopeId });
    let anterior: string | null = null;
    if (c.substituiId && o.cancelarAnterior !== false) anterior = await cancelarVersaoAnterior(c.substituiId).catch((e) => `Não cancelei a versão anterior: ${(e as Error).message}`);
    return { contrato: atualizado, notificado: r.notificado, aviso: [r.aviso, anterior].filter(Boolean).join(" ") || null };
  } catch (e) {
    const msg = e instanceof cs.ErroClickSign && /E-mail do usuário da API/i.test(e.message)
      ? "Falta configurar o e-mail do usuário da API na ClickSign (Configurações → API)"
      : (e as Error).message;
    await prisma.contratoEmitido.update({ where: { id }, data: { status: "ERRO", ultimoErro: msg.slice(0, 500) } });
    await registrarEvento(id, "ERRO_ENVIO", { mensagem: msg, passo: (e as cs.ErroClickSign).passo ?? null });
    throw new ErroContrato(`ClickSign: ${msg}`, 502);
  }
}

async function cancelarVersaoAnterior(id: string): Promise<string | null> {
  const a = await prisma.contratoEmitido.findUnique({ where: { id }, select: { envelopeId: true, documentoId: true, status: true, provedor: true } });
  if (!a?.envelopeId || a.provedor !== "clicksign" || !STATUS_EM_ABERTO.includes(a.status as StatusContrato)) return null;
  await cs.cancelarEnvelope(a.envelopeId, a.documentoId);
  await prisma.contratoEmitido.update({ where: { id }, data: { status: "CANCELADO" } });
  await registrarEvento(id, "CANCELADO", { motivo: "Substituído por nova versão do contrato" }, { envelopeId: a.envelopeId });
  return "Versão anterior cancelada.";
}

async function exigirEnvelope(id: string) {
  const c = await prisma.contratoEmitido.findUnique({ where: { id } });
  if (!c) throw new ErroContrato("Contrato não encontrado", 404);
  if (c.provedor !== "clicksign") throw new ErroContrato("Contrato importado do ZapSign: só leitura", 409);
  if (!c.envelopeId) throw new ErroContrato("Contrato ainda não foi enviado", 409);
  if (!cs.clickSignConfigurada()) throw new ErroContrato("ClickSign não configurada no servidor (CLICKSIGN_TOKEN)", 503);
  return c as typeof c & { envelopeId: string };
}

export async function reenviarContrato(id: string, uid?: string | null) {
  const c = await exigirEnvelope(id);
  if (!STATUS_EM_ABERTO.includes(c.status as StatusContrato)) throw new ErroContrato("Só dá para reenviar contrato aguardando assinatura", 409);
  try { await cs.reenviarNotificacao(c.envelopeId); } catch (e) { throw new ErroContrato(`ClickSign: ${(e as Error).message}`, 502); }
  await registrarEvento(id, "REENVIADO", { por: uid ?? null }, { envelopeId: c.envelopeId });
}

export async function cancelarContrato(id: string, uid?: string | null) {
  const c = await prisma.contratoEmitido.findUnique({ where: { id } });
  if (!c) throw new ErroContrato("Contrato não encontrado", 404);
  if (c.status === "ASSINADO") throw new ErroContrato("Contrato já assinado não pode ser cancelado", 409);
  if (c.status === "CANCELADO") return;
  if (c.envelopeId && c.provedor === "clicksign" && STATUS_EM_ABERTO.includes(c.status as StatusContrato)) {
    await exigirEnvelope(id);
    try { await cs.cancelarEnvelope(c.envelopeId, c.documentoId); } catch (e) { throw new ErroContrato(`ClickSign: ${(e as Error).message}`, 502); }
  } else if (c.provedor !== "clicksign") throw new ErroContrato("Contrato importado do ZapSign: só leitura", 409);
  await prisma.contratoEmitido.update({ where: { id }, data: { status: "CANCELADO" } });
  await registrarEvento(id, "CANCELADO", { por: uid ?? null }, { envelopeId: c.envelopeId });
}

// ── Status (webhook, reconciliação, botão "Atualizar") ──────────────────────

/** Muda o status e, ao virar ASSINADO, guarda o PDF assinado e roda a automação. Idempotente. */
export async function aplicarStatus(id: string, novo: StatusContrato, o: { urlAssinado?: string | null; quando?: Date } = {}) {
  const c = await prisma.contratoEmitido.findUnique({ where: { id }, select: { status: true, assinadoEm: true } });
  if (!c) return;
  // ASSINADO é final; CANCELADO/RECUSADO só voltam se a ClickSign disser "fechado".
  if (c.status === "ASSINADO" && novo !== "ASSINADO") return;
  if (c.status !== novo) {
    await prisma.contratoEmitido.update({
      where: { id }, data: { status: novo, ultimoErro: null, ...(novo === "ASSINADO" && !c.assinadoEm ? { assinadoEm: o.quando ?? new Date() } : {}) },
    });
  }
  if (novo === "ASSINADO") {
    await guardarAssinado(id, o.urlAssinado).catch((e) => console.error("[contratos] PDF assinado não baixado:", (e as Error).message));
    const { aoAssinarContrato } = await import("./automacao");
    await aoAssinarContrato(id);
  }
}

/** Baixa o PDF assinado da ClickSign para ContratoArquivo(ASSINADO), se ainda não estiver lá. */
export async function guardarAssinado(id: string, url?: string | null): Promise<boolean> {
  const ja = await prisma.contratoArquivo.findUnique({ where: { contratoId_tipo: { contratoId: id, tipo: "ASSINADO" } }, select: { id: true } });
  if (ja) return true;
  const c = await prisma.contratoEmitido.findUnique({ where: { id }, select: { envelopeId: true, documentoId: true, filename: true, provedor: true } });
  if (!c?.envelopeId || c.provedor !== "clicksign" || !cs.clickSignConfigurada()) return false;
  let link = url ?? null;
  if (!link) {
    const est = await cs.consultarEnvelope(c.envelopeId);
    link = (est.documentos.find((d) => d.id === c.documentoId) ?? est.documentos[0])?.assinado ?? null;
  }
  if (!link) return false;
  const bytes = await cs.baixarArquivo(link);
  const nome = c.filename.replace(/\.pdf$/i, "") + "_assinado.pdf";
  await prisma.contratoArquivo.upsert({
    where: { contratoId_tipo: { contratoId: id, tipo: "ASSINADO" } },
    create: { contratoId: id, tipo: "ASSINADO", nome, bytes, sha256: sha256(bytes) }, update: {},
  });
  return true;
}

/** Consulta o envelope na ClickSign e aplica o status real. */
export async function atualizarDaClickSign(id: string) {
  const c = await exigirEnvelope(id);
  let est: cs.EstadoEnvelope;
  try { est = await cs.consultarEnvelope(c.envelopeId); } catch (e) { throw new ErroContrato(`ClickSign: ${(e as Error).message}`, 502); }
  const novo = statusDoEnvelope(est.status, c.status);
  const doc = est.documentos.find((d) => d.id === c.documentoId) ?? est.documentos[0];
  if (novo) await aplicarStatus(id, novo, { urlAssinado: doc?.assinado ?? null });
  return { status: novo ?? c.status, bruto: est.status };
}

/** Rede de segurança do webhook: envelopes enviados há mais de 10 min ainda em aberto, e assinados sem PDF/automação. */
export async function reconciliarContratos(o: { limite?: number; agora?: Date } = {}) {
  const agora = o.agora ?? new Date();
  const res = { consultados: 0, mudaram: 0, erros: 0, pendentes: 0 };
  if (!cs.clickSignConfigurada()) return { ...res, semToken: true };
  const abertos = await prisma.contratoEmitido.findMany({
    where: { provedor: "clicksign", envelopeId: { not: null }, status: { in: STATUS_EM_ABERTO }, enviadoEm: { lt: new Date(agora.getTime() - 10 * 60_000) } },
    orderBy: { atualizadoEm: "asc" }, take: o.limite ?? 20, select: { id: true, status: true },
  });
  for (const c of abertos) {
    res.consultados++;
    try {
      const r = await atualizarDaClickSign(c.id);
      if (r.status !== c.status) res.mudaram++;
    } catch (e) { res.erros++; console.error("[contratos] reconciliação falhou:", c.id, (e as Error).message); }
    // Toca no registro: o próximo ciclo começa pelos mais antigos.
    await prisma.contratoEmitido.update({ where: { id: c.id }, data: { atualizadoEm: new Date() } }).catch(() => {});
  }
  // Assinados que ficaram sem PDF ou sem automação (falha passageira): tenta de novo.
  const assinados = await prisma.contratoEmitido.findMany({
    where: { provedor: "clicksign", status: "ASSINADO", OR: [{ automatizadoEm: null }, { arquivos: { none: { tipo: "ASSINADO" } } }] },
    take: 10, select: { id: true },
  });
  for (const c of assinados) { res.pendentes++; await aplicarStatus(c.id, "ASSINADO").catch(() => {}); }
  return res;
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export interface FiltroContratos { status?: string | null; q?: string | null; oportunidadeId?: string | null; contatoId?: string | null; limite?: number }

export async function listarContratos(f: FiltroContratos = {}) {
  const q = f.q?.trim().slice(0, 80);
  const digitos = q?.replace(/\D/g, "") ?? "";
  const where: Prisma.ContratoEmitidoWhereInput = {
    ...(f.status ? (f.status === "ABERTOS" ? { status: { in: STATUS_EM_ABERTO } } : { status: f.status }) : {}),
    ...(f.oportunidadeId ? { oportunidadeId: f.oportunidadeId } : {}),
    ...(f.contatoId ? { contatoId: f.contatoId } : {}),
    ...(q ? { OR: [
      { razaoSocial: { contains: q, mode: "insensitive" } }, { nomeFantasia: { contains: q, mode: "insensitive" } },
      { representante: { contains: q, mode: "insensitive" } }, { filename: { contains: q, mode: "insensitive" } },
      ...(digitos.length >= 4 ? [{ cnpj: { contains: digitos } }] : []),
    ] } : {}),
  };
  const lista = await prisma.contratoEmitido.findMany({
    where, orderBy: { criadoEm: "desc" }, take: Math.min(f.limite ?? 200, 500),
    select: {
      id: true, razaoSocial: true, nomeFantasia: true, modelo: true, plano: true, valor: true, status: true, provedor: true, origem: true,
      criadoEm: true, enviadoEm: true, assinadoEm: true, filename: true, substituiId: true, ultimoErro: true,
      oportunidade: { select: { id: true, funilId: true, nome: true } },
      arquivos: { select: { tipo: true } },
    },
  });
  return lista.map((c) => ({ ...c, valor: c.valor === null ? null : Number(c.valor), arquivos: c.arquivos.map((a) => a.tipo) }));
}

export async function detalheContrato(id: string) {
  const c = await prisma.contratoEmitido.findUnique({
    where: { id },
    include: {
      oportunidade: { select: { id: true, funilId: true, nome: true, status: true } },
      contato: { select: { id: true, nome: true } },
      arquivos: { select: { id: true, tipo: true, nome: true, sha256: true, criadoEm: true }, orderBy: { criadoEm: "asc" } },
      eventos: { select: { id: true, tipo: true, recebidoEm: true, payload: true }, orderBy: { recebidoEm: "desc" }, take: 100 },
    },
  });
  if (!c) return null;
  // Versões: a cadeia "substitui" para trás e quem substituiu este para frente.
  const versoes: Array<{ id: string; status: string; criadoEm: Date; filename: string }> = [];
  let anterior = c.substituiId;
  for (let i = 0; anterior && i < 20; i++) {
    const v = await prisma.contratoEmitido.findUnique({ where: { id: anterior }, select: { id: true, status: true, criadoEm: true, filename: true, substituiId: true } });
    if (!v) break;
    versoes.push(v);
    anterior = v.substituiId;
  }
  const posteriores = await prisma.contratoEmitido.findMany({ where: { substituiId: id }, select: { id: true, status: true, criadoEm: true, filename: true } });
  return { ...c, valor: c.valor === null ? null : Number(c.valor), versoesAnteriores: versoes, versoesPosteriores: posteriores };
}

export async function arquivoDoContrato(id: string, tipo: string) {
  return prisma.contratoArquivo.findUnique({ where: { contratoId_tipo: { contratoId: id, tipo } } });
}
