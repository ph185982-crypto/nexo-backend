// ── Manager WhatsApp Command Handler ────────────────────────────────────────
// When the owner's number (MANAGER_NUMBER) sends a message to the business
// WhatsApp, this module intercepts it, parses the command, queries the DB
// and replies with real-time stats — no AI lead flow is triggered.

import { adminRepository } from "@/lib/admin/admin.repository";
import { handleFreeQuery } from "@/lib/admin/admin-report.service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export const MANAGER_NUMBER =
  process.env.MANAGER_WHATSAPP_NUMBER ?? "5562984465388";

// ── Normalize BR phone: strip country code 55 and the mobile "9" prefix ────
// Makes comparison tolerant to both 12-digit (55 + DDD + 8) and 13-digit
// (55 + DDD + 9 + 8) formats that WhatsApp/Meta deliver interchangeably.
function canonicalBR(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);
  if (n.length === 11 && n[2] === "9") n = n.slice(0, 2) + n.slice(3);
  return n; // always 10 digits (DDD + 8)
}

export function isManagerNumber(phone: string): boolean {
  return canonicalBR(phone) === canonicalBR(MANAGER_NUMBER);
}

// ── Command router ───────────────────────────────────────────────────────────

type ProviderConfig = {
  businessPhoneNumberId: string;
  accessToken?: string | null;
};

export async function handleManagerMessage(
  text: string,
  providerConfig: ProviderConfig,
  replyTo?: string
): Promise<void> {
  const { businessPhoneNumberId, accessToken } = providerConfig;
  const token = accessToken ?? undefined;
  // Reply to the wa_id that sent the message (preserves 12/13-digit format Meta gave us).
  const target = replyTo ?? MANAGER_NUMBER;
  const cmd = text.toLowerCase().trim();

  console.log(`[Manager] cmd="${cmd.slice(0, 60)}" → reply to ${target}`);

  const send = (msg: string) =>
    sendWhatsAppMessage(businessPhoneNumberId, target, msg, token);

  // ── vendas / pedidos ───────────────────────────────────────────────────────
  if (/vend[as]|pedid[os]|confirmad[os]|quantas vendas/i.test(cmd)) {
    const { confirmadas, pedidos } = await adminRepository.getVendasHoje();
    let msg = `*📦 VENDAS DE HOJE*\n\n${confirmadas} pedido(s) confirmado(s)`;
    if (pedidos.length > 0) {
      msg +=
        "\n\n*Detalhes:*\n" +
        pedidos
          .map(
            (p, i) =>
              `${i + 1}. ${p.title} — ${p.createdAt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`,
          )
          .join("\n");
    }
    await send(msg);
    return;
  }

  // ── leads ativos ──────────────────────────────────────────────────────────
  if (/leads|quantos leads|atend/i.test(cmd)) {
    const [ativos, atendidos] = await Promise.all([
      adminRepository.getLeadsAtivos(),
      adminRepository.getLeadsAtendidos(24),
    ]);
    await send(
      `*👥 LEADS*\n\n` +
        `• Ativos agora: *${ativos}*\n` +
        `• Atendidos (últimas 24h): *${atendidos}*`,
    );
    return;
  }

  // ── números dos clientes ──────────────────────────────────────────────────
  if (/n[uú]mero|cliente|contato|telefone/i.test(cmd)) {
    const leads = await adminRepository.getNumeroClientes(15);
    if (leads.length === 0) {
      await send("Nenhum lead novo nas últimas 24h.");
      return;
    }
    const lista = leads
      .map((l, i) => `${i + 1}. ${l.profileName ?? "Sem nome"} — wa.me/${l.phoneNumber}`)
      .join("\n");
    await send(`*📱 LEADS RECENTES (24h)*\n\n${lista}`);
    return;
  }

  // ── objeções ─────────────────────────────────────────────────────────────
  if (/objeç[aã]o|objeções|reclamaç|dificuldade/i.test(cmd)) {
    const obj = await adminRepository.getObjecoes(24);
    await send(
      `*🚧 OBJEÇÕES (24h)*\n\n` +
        `💸 Preço caro: ${obj.caro}x\n` +
        `⏳ Prazo: ${obj.prazo}x\n` +
        `🤔 Desconfiança: ${obj.desconfianca}x\n` +
        `🛒 Concorrente: ${obj.concorrente}x`,
    );
    return;
  }

  // ── perdidos ──────────────────────────────────────────────────────────────
  if (/perdid[os]|desistência|fora.area|nao.fechou/i.test(cmd)) {
    const perdidos = await adminRepository.getLeadsPerdidos(24);
    await send(`*❌ LEADS PERDIDOS (24h)*\n\n${perdidos} lead(s) perdidos ou fora da área`);
    return;
  }

  // ── qualidade de leads ────────────────────────────────────────────────────
  if (/qualidade|qualificad|lead.bom|lead.ruim/i.test(cmd)) {
    const q = await adminRepository.getQualidadeLeads(24);
    const taxaConv = q.total > 0 ? ((q.confirmados / q.total) * 100).toFixed(1) : "0";
    const taxaQuente = q.total > 0 ? ((q.quentes / q.total) * 100).toFixed(1) : "0";
    await send(
      `*🎯 QUALIDADE DOS LEADS (24h)*\n\n` +
        `• Total de leads: ${q.total}\n` +
        `• Qualificados/quentes: ${q.quentes} (${taxaQuente}%)\n` +
        `• Confirmados: ${q.confirmados} (${taxaConv}% conversão)\n` +
        `• Perdidos: ${q.perdidos}\n` +
        `• Fora da área: ${q.foraArea}`,
    );
    return;
  }

  // ── resumo completo ───────────────────────────────────────────────────────
  if (/resumo|dashboard|relat|status|como.t[aá]/i.test(cmd)) {
    const [vendas, ativos, perdidos, atendidos, obj, q] = await Promise.all([
      adminRepository.getVendasHoje(),
      adminRepository.getLeadsAtivos(),
      adminRepository.getLeadsPerdidos(24),
      adminRepository.getLeadsAtendidos(24),
      adminRepository.getObjecoes(24),
      adminRepository.getQualidadeLeads(24),
    ]);
    const taxaConv = q.total > 0 ? ((vendas.confirmadas / q.total) * 100).toFixed(1) : "0";
    const hora = new Date().toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    await send(
      `*📊 RESUMO — ${hora} (Brasília)*\n\n` +
        `📦 Vendas hoje: *${vendas.confirmadas}*\n` +
        `👥 Leads ativos: ${ativos}\n` +
        `💬 Atendidos (24h): ${atendidos}\n` +
        `❌ Perdidos (24h): ${perdidos}\n` +
        `🎯 Conversão: ${taxaConv}%\n\n` +
        `*Objeções:*\n` +
        `💸 Preço: ${obj.caro}x | ⏳ Prazo: ${obj.prazo}x | 🛒 Concorr.: ${obj.concorrente}x`,
    );
    return;
  }

  // ── ajuda ─────────────────────────────────────────────────────────────────
  if (/ajuda|help|comando|oque.*faz|o que.*faz/i.test(cmd)) {
    await send(
      `*🤖 COMANDOS DISPONÍVEIS*\n\n` +
        `• *vendas* — pedidos confirmados hoje\n` +
        `• *leads* — quantos leads ativos\n` +
        `• *números* — whatsapp dos clientes recentes\n` +
        `• *objeções* — dificuldades do bot (24h)\n` +
        `• *perdidos* — leads que não fecharam\n` +
        `• *qualidade* — análise dos leads\n` +
        `• *resumo* — dashboard completo\n\n` +
        `Ou pergunte qualquer coisa sobre as vendas! 💬`,
    );
    return;
  }

  // ── pergunta livre → LLM ─────────────────────────────────────────────────
  const resposta = await handleFreeQuery(text);
  await send(resposta);
}
