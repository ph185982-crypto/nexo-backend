// Perfil do WhatsApp comercial (o que o lead vê ao abrir o contato): Graph API com o token que já está no servidor.
// Nunca registra token nem PIN em log/notificação. Roda uma vez (marca em max_alertas_enviados) pela rotina horária
// e o resultado fica numa notificação do CRM ("📱 Perfil do WhatsApp…") para conferência.
//  1. confere o número (tem de ser o (62) 99325-0802; se não for, PARA e só registra o diagnóstico)
//  2. atualiza recado, descrição, e-mail, site, endereço e categoria
//  3. pede a troca do nome de exibição para "Avanteza" (a Meta analisa; depois de aprovado, registrar em até 14 dias)
//  4. corrige o WhatsappProviderConfig (accountName "Avanteza", displayPhoneNumber da API)
import { prisma } from "@/lib/prisma/client";
import { canonicalBrazilianNumber } from "./send";
import { MARCA_NOME_REGISTRADO } from "@/lib/ai/sdr/julia/persona";

const GRAPH = "https://graph.facebook.com/v20.0";
export const NUMERO_JULIA = "6293250802"; // canônico (DDD + 8 dígitos) de (62) 99325-0802
export const NOME_EXIBICAO = "Avanteza";
// v2 (25/11): descrição sem citar a Júlia, porque até o nome "Avanteza" sair a SDR se apresenta como Pedro.
const MARCA = "perfil-whatsapp-avanteza-v2";

export const PERFIL_AVANTEZA = {
  messaging_product: "whatsapp",
  about: "Consultoria de marketplace para lojistas de Goiânia",
  description:
    "A Avanteza coloca lojistas de Goiânia para vender no Mercado Livre, na Shopee e no TikTok Shop, com o nosso time operando junto e as contas no seu nome. Aqui no WhatsApp o primeiro atendimento é do nosso assistente virtual, e a ligação é com o Pedro, fundador. Atendimento de segunda a sexta, das 9h às 17h.",
  email: "pedro@avanteza.com.br",
  websites: ["https://avanteza.com.br"],
  address: "Goiânia, GO",
  vertical: "PROF_SERVICES",
} as const;

type Json = Record<string, unknown>;
async function graph(metodo: "GET" | "POST", caminho: string, token: string, corpo?: Json): Promise<{ ok: boolean; status: number; dados: Json }> {
  const r = await fetch(`${GRAPH}/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const dados = (await r.json().catch(() => ({}))) as Json;
  return { ok: r.ok, status: r.status, dados };
}
/** Erro da Graph sem nada sensível (só código, tipo e mensagem). */
function erroLimpo(d: Json): string {
  const e = (d.error ?? {}) as Json;
  return [e.code, e.error_subcode, e.type, e.message].filter(Boolean).join(" · ").slice(0, 300);
}

export interface ContaWhatsapp { id: string; businessPhoneNumberId: string; accessToken: string | null; organizationId: string }

async function contaDaJulia(): Promise<ContaWhatsapp | null> {
  const ag = await prisma.agent.findFirst({ where: { systemPrompt: { startsWith: "[SDR]" } }, select: { config: { select: { id: true, businessPhoneNumberId: true, accessToken: true, organizationId: true } } } });
  return ag?.config ?? null;
}
const tokenDa = (c: ContaWhatsapp) => c.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? "";

export async function lerNumero(c: ContaWhatsapp) {
  return graph("GET", `${c.businessPhoneNumberId}?fields=display_phone_number,verified_name,name_status,new_display_name,new_name_status,quality_rating`, tokenDa(c));
}
export async function lerPerfil(c: ContaWhatsapp) {
  return graph("GET", `${c.businessPhoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, tokenDa(c));
}

async function registrarResultado(organizationId: string, titulo: string, corpo: Json): Promise<void> {
  await prisma.ownerNotification.create({ data: { type: "INFO", title: titulo, body: JSON.stringify(corpo, null, 2).slice(0, 8000), organizationId } }).catch(() => {});
}

/** Uma vez: confere o número, atualiza o perfil, pede o nome "Avanteza" e corrige o cadastro da conta. */
export async function atualizarPerfilAvanteza(opts: { forcar?: boolean } = {}): Promise<Json> {
  const c = await contaDaJulia();
  if (!c || !tokenDa(c)) return { situacao: "sem_conta_ou_token" };
  if (!opts.forcar) {
    try { await prisma.alertaEnviadoMax.create({ data: { chave: MARCA } }); } catch { return { situacao: "ja_feito" }; }
  }
  const numero = await lerNumero(c);
  const n = numero.dados as { display_phone_number?: string; verified_name?: string; new_name_status?: string; new_display_name?: string; name_status?: string };
  if (!numero.ok) {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: MARCA } }).catch(() => {});
    const r = { situacao: "erro_ao_ler_numero", erro: erroLimpo(numero.dados) };
    await registrarResultado(c.organizationId, "📱 Perfil do WhatsApp: não consegui ler o número", r);
    return r;
  }
  if (canonicalBrazilianNumber(String(n.display_phone_number ?? "")) !== NUMERO_JULIA) {
    const r = { situacao: "numero_diferente_nada_alterado", numero: n };
    await registrarResultado(c.organizationId, "📱 Perfil do WhatsApp: o número não é o (62) 99325-0802 — nada foi alterado", r);
    return r;
  }

  const antes = await lerPerfil(c);
  const perfil = await graph("POST", `${c.businessPhoneNumberId}/whatsapp_business_profile`, tokenDa(c), { ...PERFIL_AVANTEZA, websites: [...PERFIL_AVANTEZA.websites] });
  await prisma.whatsappProviderConfig.update({ where: { id: c.id }, data: { accountName: NOME_EXIBICAO, displayPhoneNumber: String(n.display_phone_number) } }).catch(() => {});

  let nome: Json = { situacao: "ja_e_avanteza" };
  if (String(n.verified_name ?? "").trim().toLowerCase() !== NOME_EXIBICAO.toLowerCase() && !/PENDING/i.test(String(n.new_name_status ?? ""))) {
    const r = await graph("POST", `${c.businessPhoneNumberId}?new_display_name=${encodeURIComponent(NOME_EXIBICAO)}`, tokenDa(c));
    nome = r.ok ? { situacao: "pedido_enviado", resposta: r.dados } : { situacao: "recusado", erro: erroLimpo(r.dados) };
  }
  const depois = await lerPerfil(c);
  const numeroDepois = await lerNumero(c);
  const resultado = {
    situacao: perfil.ok ? "perfil_atualizado" : "perfil_recusado",
    numero: n, nome_verificado_era_pedro: String(n.verified_name ?? "").trim().toLowerCase() === "pedro",
    perfil_erro: perfil.ok ? null : erroLimpo(perfil.dados),
    perfil_antes: antes.dados, perfil_depois: depois.dados,
    troca_de_nome: nome, numero_depois: numeroDepois.dados,
  };
  await registrarResultado(c.organizationId, perfil.ok ? "📱 Perfil do WhatsApp atualizado (Avanteza)" : "📱 Perfil do WhatsApp: a Meta recusou a atualização", resultado);
  console.log(`[PerfilWhatsApp] ${resultado.situacao} | nome: ${String((nome as { situacao?: string }).situacao)}`);
  return resultado;
}

/** Status do pedido de nome. Com APPROVED, o número precisa ser registrado de novo em até 14 dias. */
export async function statusDoNome(): Promise<{ verified_name?: string; new_display_name?: string; new_name_status?: string; name_status?: string; erro?: string } | null> {
  const c = await contaDaJulia();
  if (!c) return null;
  const r = await lerNumero(c);
  return r.ok ? (r.dados as never) : { erro: erroLimpo(r.dados) };
}

/** Registra o número de novo (depois da aprovação do nome). PIN de 2 etapas só da variável WHATSAPP_2FA_PIN. */
export async function registrarNumero(): Promise<{ ok: boolean; erro?: string }> {
  const c = await contaDaJulia();
  const pin = process.env.WHATSAPP_2FA_PIN?.trim();
  if (!c) return { ok: false, erro: "conta da Júlia não encontrada" };
  if (!pin) return { ok: false, erro: "WHATSAPP_2FA_PIN não está configurado" };
  const r = await graph("POST", `${c.businessPhoneNumberId}/register`, tokenDa(c), { messaging_product: "whatsapp", pin });
  if (r.ok) await marcarNomeRegistrado();
  return r.ok ? { ok: true } : { ok: false, erro: erroLimpo(r.dados) };
}

/** Nome "Avanteza" valendo no WhatsApp: a SDR passa de Pedro para Júlia (julia/persona.ts). */
async function marcarNomeRegistrado(): Promise<void> {
  await prisma.alertaEnviadoMax.create({ data: { chave: MARCA_NOME_REGISTRADO } }).catch(() => {});
  console.log("[PerfilWhatsApp] Nome Avanteza valendo — a SDR passa a se apresentar como Júlia");
}

/**
 * Rotina (1 consulta por dia até o nome valer): quando o nome for aprovado, avisa o Pedro (uma vez) que falta registrar
 * o número em até 14 dias; quando o WhatsApp já mostrar "Avanteza", grava a marca que troca a SDR para Júlia.
 */
export async function avisarNomeAprovado(): Promise<void> {
  if (await prisma.alertaEnviadoMax.findUnique({ where: { chave: MARCA_NOME_REGISTRADO } }).catch(() => null)) return;
  const dia = new Date().toISOString().slice(0, 10);
  try { await prisma.alertaEnviadoMax.create({ data: { chave: `whatsapp-nome-status:${dia}` } }); } catch { return; } // 1 consulta por dia
  const s = await statusDoNome();
  if (s && String(s.verified_name ?? "").trim().toLowerCase() === NOME_EXIBICAO.toLowerCase()) { await marcarNomeRegistrado(); return; }
  if (await prisma.alertaEnviadoMax.findUnique({ where: { chave: "whatsapp-nome-aprovado-aviso" } }).catch(() => null)) return;
  if (!s || !/APPROVED/i.test(String(s.new_name_status ?? ""))) return;
  const c = await contaDaJulia();
  if (!c) return;
  await prisma.alertaEnviadoMax.create({ data: { chave: "whatsapp-nome-aprovado-aviso" } }).catch(() => {});
  await prisma.ownerNotification.create({ data: { type: "INFO", title: "✅ Nome \"Avanteza\" aprovado no WhatsApp — registrar em até 14 dias", body: "A Meta aprovou o nome. Falta registrar o número de novo (precisa do PIN de 2 etapas em WHATSAPP_2FA_PIN): rode `npm run whatsapp:nome` ou peça ao Claude.", organizationId: c.organizationId } }).catch(() => {});
  const { sendPushToAll } = await import("@/lib/push/notificar");
  await sendPushToAll({ title: "✅ Nome Avanteza aprovado no WhatsApp", body: "Falta registrar o número em até 14 dias.", url: "/crm/settings", tag: "whatsapp-nome" }).catch(() => {});
}
