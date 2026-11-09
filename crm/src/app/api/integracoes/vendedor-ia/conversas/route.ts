// Conversas do WhatsApp que o Vendedor IA espelha no CRM (contrato: crm/docs/integracao.md).
// Só de leads que o CRM conhece; os demais respondem IGNORADO e o Vendedor IA para de mandar.
// Autenticação: Authorization: Bearer avz_live_… (chave de serviço).
import { validarChave } from "@/lib/integracao/chave";
import { comEntrada, ErroEntrada, texto } from "@/lib/validar";
import { analisarConversasOciosas, contatoDoLead, importarConversa, validarMensagens } from "@/lib/conversas/importar";
import { processarPendentes } from "@/lib/combinados/fontes";
import { normalizarTelefone } from "@/lib/integracao/vendedor-ia";
import { depoisDaResposta } from "@/lib/segundo-plano";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await validarChave(req))) return Response.json({ erro: "Chave inválida" }, { status: 401 });
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const leadId = texto(c.leadId, "leadId", { min: 4, max: 120 });
    const contatoId = await contatoDoLead(leadId, normalizarTelefone(typeof c.telefone === "string" ? c.telefone : null));
    if (!contatoId) return Response.json({ status: "IGNORADO" });
    if (!Array.isArray(c.mensagens)) throw new ErroEntrada("mensagens deve ser uma lista");
    if (c.mensagens.length === 0) return Response.json({ status: "CONHECIDO" });
    const r = await importarConversa({ contatoId, mensagens: validarMensagens(c.mensagens), origem: "VENDEDOR_IA" });
    // Conversas que já esfriaram vão para o agente depois da resposta (não segura o Vendedor IA).
    depoisDaResposta(async () => {
      const r = await analisarConversasOciosas({ agendarAgente: false });
      if (r.analises) await processarPendentes(r.analises);
    });
    return Response.json({ status: "PROCESSADO", novas: r.novas, oportunidadeId: r.oportunidade?.id ?? null });
  });
}
