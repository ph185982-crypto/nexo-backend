// ClickSign API v3 (envelopes), só no servidor. Porta de contratos/api/clicksign.js (mesmas chamadas:
// pastas, envelope, documento, signatários, requisitos, ativação, notificação, listar, cancelar).
// Variáveis: CLICKSIGN_TOKEN (obrigatória), CLICKSIGN_BASE (padrão produção v3), CLICKSIGN_AUTO_SIGNER
// (JSON {email, documentation, birthday}: quem assina pela contratada com assinatura automática).
// O token nunca sai daqui: a tela fala só com /api/comercial/contratos.

const JSONAPI = "application/vnd.api+json";
const TIMEOUT_MS = 20_000;

type Fetch = typeof fetch;
let transporte: Fetch | null = null;
/** Testes trocam o fetch (ClickSign simulada). null volta ao fetch global. */
export function definirTransporteClickSign(f: Fetch | null) { transporte = f; }
const f = (...a: Parameters<Fetch>) => (transporte ?? fetch)(...a);

export const baseClickSign = () => (process.env.CLICKSIGN_BASE?.trim() || "https://app.clicksign.com/api/v3").replace(/\/+$/, "");
export const clickSignConfigurada = () => Boolean(process.env.CLICKSIGN_TOKEN?.trim());

export class ErroClickSign extends Error {
  constructor(message: string, public status: number, public passo: string) { super(message); }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function cs(caminho: string, metodo = "GET", corpo?: unknown): Promise<Json> {
  const token = process.env.CLICKSIGN_TOKEN?.trim();
  if (!token) throw new ErroClickSign("CLICKSIGN_TOKEN não configurado", 503, "config");
  const r = await f(`${baseClickSign()}${caminho}`, {
    method: metodo,
    headers: { Authorization: token, "Content-Type": JSONAPI, Accept: JSONAPI },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const t = await r.text();
  let d: Json;
  try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t.slice(0, 300) }; }
  if (!r.ok) {
    const e = (Array.isArray(d.errors) && d.errors[0]) || {};
    throw new ErroClickSign(String(e.detail || e.title || d.raw || `Erro ${r.status}`), r.status, `${metodo} ${caminho.split("?")[0]}`);
  }
  return d;
}

async function todasAsPastas(): Promise<Json[]> {
  const out: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await cs(`/folders?page[number]=${page}&page[size]=50`);
    const itens: Json[] = d.data || [];
    out.push(...itens);
    const total = d.meta?.record_count || 0;
    if (!itens.length || out.length >= total) break;
  }
  return out;
}

async function garantirPasta(partes: string[]): Promise<string | null> {
  const todas = await todasAsPastas();
  let paiId: string | null = null, caminhoPai = "";
  for (const nome of partes) {
    const achada = todas.find((p) => {
      const a = p.attributes || {};
      if (a.name !== nome) return false;
      const c = a.path || "";
      return paiId ? c === caminhoPai || c === `${caminhoPai}/${nome}` : a.in_root === true || c === "" || c === `/${nome}`;
    });
    if (achada) { paiId = achada.id; caminhoPai = `${caminhoPai}/${nome}`; continue; }
    const corpo: Json = { data: { type: "folders", attributes: { name: nome } } };
    if (paiId) corpo.data.relationships = { folder: { data: { type: "folders", id: paiId } } };
    const criada = await cs("/folders", "POST", corpo);
    paiId = criada.data.id; caminhoPai = `${caminhoPai}/${nome}`;
  }
  return paiId;
}

export const nomeDePasta = (s: string) => String(s || "").replace(/[\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Sem nome";

export interface Signatario { name: string; email?: string | null; phone?: string | null; channel?: "email" | "whatsapp"; role?: string; documentation?: string; birthday?: string }
export interface NovoEnvelope { name: string; filename: string; base64Pdf: string; subject?: string; message?: string | null; folder?: string[]; signers: Signatario[] }
export interface EnvelopeCriado { envelopeId: string; documentoId: string; pastaId: string | null; signatarios: Array<{ id: string; name: string; channel: string }>; notificado: boolean; aviso: string | null }

function autoSigner(): { email?: string; documentation?: string; birthday?: string } | null {
  try { return process.env.CLICKSIGN_AUTO_SIGNER ? JSON.parse(process.env.CLICKSIGN_AUTO_SIGNER) : null; } catch { return null; }
}

export async function criarEnvelope(b: NovoEnvelope): Promise<EnvelopeCriado> {
  let pastaId: string | null = null, aviso: string | null = null;
  if (b.folder?.length) {
    try { pastaId = await garantirPasta(b.folder.map(nomeDePasta)); }
    catch (e) { aviso = `Pasta não criada (${(e as Error).message}); envelope criado na raiz.`; }
  }
  const env: Json = { data: { type: "envelopes", attributes: {
    name: String(b.name || "Contrato").slice(0, 200), locale: "pt-BR", auto_close: true, remind_interval: 3, block_after_refusal: true,
    default_subject: String(b.subject || "Contrato para assinatura").slice(0, 100), default_message: b.message || null,
  } } };
  if (pastaId) env.data.relationships = { folder: { data: { type: "folders", id: pastaId } } };
  const envelopeId: string = (await cs("/envelopes", "POST", env)).data.id;
  const documentoId: string = (await cs(`/envelopes/${envelopeId}/documents`, "POST", { data: { type: "documents", attributes: {
    filename: b.filename, content_base64: `data:application/pdf;base64,${b.base64Pdf}`,
  } } })).data.id;

  const auto = autoSigner();
  const signatarios: EnvelopeCriado["signatarios"] = [];
  for (const s0 of b.signers) {
    const s = { ...s0, auto: false };
    if (auto && s.email && String(s.email).toLowerCase() === String(auto.email || "").toLowerCase()) Object.assign(s, { auto: true, documentation: auto.documentation, birthday: auto.birthday });
    const canal = s.channel === "whatsapp" && s.phone ? "whatsapp" : "email";
    const attrs: Json = {
      name: s.name, refusable: false, has_documentation: true,
      communicate_events: {
        signature_request: s.auto ? "none" : canal,
        signature_reminder: s.auto || !s.email ? "none" : "email",
        document_signed: s.email ? "email" : "whatsapp",
      },
    };
    if (s.email) attrs.email = s.email;
    if (s.phone) attrs.phone_number = String(s.phone).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (s.documentation) attrs.documentation = s.documentation;
    if (s.birthday) attrs.birthday = s.birthday;
    const sid: string = (await cs(`/envelopes/${envelopeId}/signers`, "POST", { data: { type: "signers", attributes: attrs } })).data.id;
    const rel = { document: { data: { type: "documents", id: documentoId } }, signer: { data: { type: "signers", id: sid } } };
    await cs(`/envelopes/${envelopeId}/requirements`, "POST", { data: { type: "requirements", attributes: { action: "agree", role: s.role || "party" }, relationships: rel } });
    await cs(`/envelopes/${envelopeId}/requirements`, "POST", { data: { type: "requirements", attributes: { action: "provide_evidence", auth: s.auto ? "auto_signature" : canal }, relationships: rel } });
    signatarios.push({ id: sid, name: s.name, channel: s.auto ? "auto_signature" : canal });
  }
  await cs(`/envelopes/${envelopeId}`, "PATCH", { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } });
  let notificado = true;
  try { await cs(`/envelopes/${envelopeId}/notifications`, "POST", { data: { type: "notifications", attributes: b.message ? { message: b.message } : {} } }); }
  catch { notificado = false; }
  return { envelopeId, documentoId, pastaId, signatarios, notificado, aviso };
}

export interface EstadoEnvelope { envelopeId: string; nome: string; status: string; criadoEm: string | null; documentos: Array<{ id: string; status: string; assinado: string | null }> }

/** Estado do envelope e de seus documentos (com o link do PDF assinado, válido por 5 minutos, quando existe). */
export async function consultarEnvelope(envelopeId: string): Promise<EstadoEnvelope> {
  const id = encodeURIComponent(envelopeId);
  const [e, d] = await Promise.all([cs(`/envelopes/${id}`), cs(`/envelopes/${id}/documents`)]);
  return {
    envelopeId: e.data.id, nome: e.data.attributes?.name ?? "", status: e.data.attributes?.status ?? "", criadoEm: e.data.attributes?.created ?? null,
    documentos: (d.data || []).map((x: Json) => ({ id: x.id, status: x.attributes?.status ?? "", assinado: x.links?.files?.signed ?? null })),
  };
}

/** Baixa o PDF de um link de arquivo da ClickSign (S3 assinado: sem o token). */
export async function baixarArquivo(url: string): Promise<Buffer> {
  const r = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new ErroClickSign(`Download falhou (HTTP ${r.status})`, r.status, "download");
  return Buffer.from(await r.arrayBuffer());
}

export async function listarEnvelopes(tamanho = 50) {
  const d = await cs(`/envelopes?sort=-created&page[size]=${tamanho}`);
  return (d.data || []).map((e: Json) => ({ envelopeId: e.id as string, nome: (e.attributes?.name ?? "") as string, status: (e.attributes?.status ?? "") as string, criadoEm: (e.attributes?.created ?? null) as string | null }));
}

export async function reenviarNotificacao(envelopeId: string) {
  await cs(`/envelopes/${encodeURIComponent(envelopeId)}/notifications`, "POST", { data: { type: "notifications", attributes: {} } });
}

export async function cancelarEnvelope(envelopeId: string, documentoId?: string | null) {
  const id = encodeURIComponent(envelopeId);
  let docs = documentoId ? [documentoId] : [];
  if (!docs.length) docs = ((await cs(`/envelopes/${id}/documents`)).data || []).map((d: Json) => d.id);
  for (const did of docs) {
    await cs(`/envelopes/${id}/documents/${encodeURIComponent(did)}`, "PATCH", { data: { id: did, type: "documents", attributes: { status: "canceled" } } });
  }
}

/** Confere se o token responde (tela de Contratos mostra o aviso). */
export async function statusDaConta(): Promise<{ ok: boolean; mensagem?: string }> {
  if (!clickSignConfigurada()) return { ok: false, mensagem: "CLICKSIGN_TOKEN não configurado" };
  try { await cs("/envelopes?page[size]=1"); return { ok: true }; }
  catch (e) { return { ok: false, mensagem: `ClickSign: ${(e as Error).message}` }; }
}
