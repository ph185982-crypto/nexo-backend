import { adminRepository } from "@/lib/admin/admin.repository";
import { handleFreeQuery } from "@/lib/admin/admin-report.service";

export async function consultarCrm(args: Record<string, unknown>): Promise<string> {
  const pergunta = (args.pergunta as string).toLowerCase().trim();

  // Try matching common patterns to use direct repository calls
  if (matchesAny(pergunta, ["vendas hoje", "vendas do dia", "quantas vendas hoje"])) {
    const vendas = await adminRepository.getVendasHoje();
    const lines = [
      `Vendas de hoje:`,
      `  Pedidos confirmados: ${vendas.confirmadas}`,
    ];
    if (vendas.pedidos.length > 0) {
      lines.push(`\nUltimos pedidos:`);
      for (const p of vendas.pedidos) {
        lines.push(`  - ${p.title}: ${p.body}`);
      }
    }
    return lines.join("\n");
  }

  if (matchesAny(pergunta, ["leads ativos", "quantos leads", "leads abertos"])) {
    const count = await adminRepository.getLeadsAtivos();
    return `Leads ativos no momento: ${count}`;
  }

  if (matchesAny(pergunta, ["leads atendidos", "atendimentos"])) {
    const count = await adminRepository.getLeadsAtendidos(24);
    return `Leads atendidos nas ultimas 24h: ${count}`;
  }

  if (matchesAny(pergunta, ["leads perdidos", "perdemos quantos"])) {
    const count = await adminRepository.getLeadsPerdidos(24);
    return `Leads perdidos nas ultimas 24h: ${count}`;
  }

  if (matchesAny(pergunta, ["qualidade", "qualidade dos leads", "qualidade lead"])) {
    const stats = await adminRepository.getQualidadeLeads(24);
    return [
      `Qualidade dos leads (24h):`,
      `  Total: ${stats.total}`,
      `  Quentes (negociando/coletando/confirmados): ${stats.quentes}`,
      `  Confirmados: ${stats.confirmados}`,
      `  Perdidos: ${stats.perdidos}`,
      `  Fora da area: ${stats.foraArea}`,
      `  Taxa de conversao: ${stats.total > 0 ? Math.round((stats.confirmados / stats.total) * 100) : 0}%`,
    ].join("\n");
  }

  if (matchesAny(pergunta, ["objecoes", "objecao", "principais objecoes"])) {
    const objecoes = await adminRepository.getObjecoes(24);
    const total = objecoes.caro + objecoes.prazo + objecoes.desconfianca + objecoes.concorrente;
    if (total === 0) return "Nenhuma objecao registrada nas ultimas 24h.";
    return [
      `Objecoes (24h) — Total: ${total}`,
      "",
      `  Preco (caro): ${objecoes.caro}`,
      `  Prazo: ${objecoes.prazo}`,
      `  Desconfianca: ${objecoes.desconfianca}`,
      `  Concorrente: ${objecoes.concorrente}`,
    ].join("\n");
  }

  if (matchesAny(pergunta, ["clientes", "numeros de clientes", "contatos"])) {
    const clientes = await adminRepository.getNumeroClientes(10);
    if (clientes.length === 0) return "Nenhum cliente encontrado nas ultimas 24h.";
    return [
      `Ultimos clientes (24h):`,
      "",
      ...clientes.map(
        (c) =>
          `  - ${c.profileName ?? "Sem nome"} (${c.phoneNumber}) — ${c.createdAt.toLocaleDateString("pt-BR")}`,
      ),
    ].join("\n");
  }

  if (
    matchesAny(pergunta, [
      "resumo",
      "resumo geral",
      "como estao as vendas",
      "dashboard",
      "visao geral",
    ])
  ) {
    const [vendas, leadsAtivos, leadsAtendidos, leadsPerdidos, qualidade] =
      await Promise.all([
        adminRepository.getVendasHoje(),
        adminRepository.getLeadsAtivos(),
        adminRepository.getLeadsAtendidos(24),
        adminRepository.getLeadsPerdidos(24),
        adminRepository.getQualidadeLeads(24),
      ]);

    return [
      `RESUMO CRM:`,
      ``,
      `Pedidos confirmados hoje: ${vendas.confirmadas}`,
      `Leads ativos: ${leadsAtivos}`,
      `Leads atendidos (24h): ${leadsAtendidos}`,
      `Leads perdidos (24h): ${leadsPerdidos}`,
      `Qualidade leads: ${qualidade.total > 0 ? Math.round((qualidade.confirmados / qualidade.total) * 100) : 0}% convertidos (${qualidade.confirmados}/${qualidade.total})`,
      `Leads quentes: ${qualidade.quentes}`,
    ].join("\n");
  }

  // Fall back to free query LLM analysis
  return await handleFreeQuery(args.pergunta as string);
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}
