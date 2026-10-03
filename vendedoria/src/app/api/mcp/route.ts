// Servidor MCP somente leitura em /api/mcp — dá a qualquer cliente MCP
// (Claude, etc.) acesso de consulta a leads, funil, clientes e contratos,
// lendo dos mesmos modelos Prisma que o resto do app usa.
//
// Autenticação: header `Authorization: Bearer <token>` comparado com
// process.env.MCP_SECRET (nunca hardcoded — configure a env var no projeto
// na Vercel). Sem relação com o sistema de ApiKey de /api/graphql —
// propositalmente mais simples, um segredo único por enquanto.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { listarModelos, consultar, agregar, OPERADORES, LIMITE_MAX as LIM } from "@/lib/mcp/consulta";
import { bearerValido, origem } from "@/lib/mcp/oauth";
import { NextRequest, NextResponse } from "next/server";
import {
  listarLeads, metricasFunil, buscarCliente, listarContratos, LIMITE_REGISTROS,
} from "@/lib/mcp/leitura";

export const maxDuration = 30;

const periodoSchema = z
  .enum(["hoje", "7d", "30d", "90d", "todos"])
  .describe("Janela de tempo: hoje, 7d, 30d (padrão), 90d ou todos.")
  .optional();

function textoJson(dado: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(dado) }] };
}

function textoErro(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ erro: msg }) }] };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "listar_leads",
      {
        title: "Listar leads",
        description: `Lista os leads do CRM (contatos do WhatsApp) criados no período pedido, mais recentes primeiro. Limite de ${LIMITE_REGISTROS} registros.`,
        inputSchema: { periodo: periodoSchema },
      },
      async ({ periodo }) => {
        try { return textoJson(await listarLeads(periodo)); }
        catch (e) { return textoErro(e); }
      },
    );

    server.registerTool(
      "metricas_funil",
      {
        title: "Métricas do funil",
        description: "Quantidade de leads por etapa do funil (Kanban) no período pedido, mais o total.",
        inputSchema: { periodo: periodoSchema },
      },
      async ({ periodo }) => {
        try { return textoJson(await metricasFunil(periodo)); }
        catch (e) { return textoErro(e); }
      },
    );

    server.registerTool(
      "buscar_cliente",
      {
        title: "Buscar cliente",
        description: `Busca por nome, telefone, CPF ou CNPJ — procura tanto entre os leads quanto entre as organizações (empresas) cadastradas. Limite de ${LIMITE_REGISTROS} registros.`,
        inputSchema: { nome_ou_cnpj: z.string().min(1).describe("Nome, telefone, CPF ou CNPJ (completo ou parcial).") },
      },
      async ({ nome_ou_cnpj }) => {
        try { return textoJson(await buscarCliente(nome_ou_cnpj)); }
        catch (e) { return textoErro(e); }
      },
    );

    server.registerTool(
      "listar_contratos",
      {
        title: "Listar contratos",
        description: `Este CRM não tem uma tabela de contratos separada — "contrato" é uma etapa do funil de vendas (Kanban). Esta ferramenta lista os leads nas etapas CONTRATO e GANHO, opcionalmente filtrados pelo status do lead (OPEN, ESCALATED, CLOSED, BLOCKED). Limite de ${LIMITE_REGISTROS} registros.`,
        inputSchema: {
          status: z.enum(["OPEN", "ESCALATED", "CLOSED", "BLOCKED"]).optional()
            .describe("Filtra pelo status do lead. Omita para trazer todos."),
        },
      },
      async ({ status }) => {
        try { return textoJson(await listarContratos(status)); }
        catch (e) { return textoErro(e); }
      },
    );

    const filtroSchema = z.object({
      campo: z.string().describe("Nome do campo (veja listar_modelos)."),
      op: z.enum(OPERADORES).describe("igual, diferente, contem (texto), maior, maior_igual, menor, menor_igual, em (lista), nulo, nao_nulo."),
      valor: z.any().optional().describe("Valor. Datas no formato AAAA-MM-DD; para 'em' passe uma lista."),
    });

    server.registerTool(
      "listar_modelos",
      {
        title: "Listar áreas e tabelas",
        description: "Mostra TODAS as áreas do sistema (Financeiro, Prospecção, CRM/Leads, Conversas, Campanhas, Agenda, Vendas/Produtos, Agente IA, Organização) com cada tabela e seus campos. Chame primeiro para saber o que consultar.",
        inputSchema: {},
      },
      async () => {
        try { return textoJson(listarModelos()); }
        catch (e) { return textoErro(e); }
      },
    );

    server.registerTool(
      "consultar",
      {
        title: "Consultar qualquer tabela",
        description: `Lê registros de qualquer tabela do sistema (somente leitura). Ex.: modelo "Transacao" para o extrato do financeiro, "ReceitaPrevistaMax" para receitas previstas, "ContaPagarMax" para contas a pagar, "ProspectLead" para empresas da prospecção, "WhatsappMessage" para mensagens. Filtre por campos, escolha as colunas e pagine com limite (máx ${LIM}) e pular. Campos secretos (senhas, tokens, chaves) nunca são devolvidos.`,
        inputSchema: {
          modelo: z.string().describe("Nome da tabela, como em listar_modelos."),
          filtros: z.array(filtroSchema).optional(),
          campos: z.array(z.string()).optional().describe("Colunas a devolver. Omita para todas."),
          ordenar_por: z.string().optional(),
          direcao: z.enum(["asc", "desc"]).optional(),
          limite: z.number().int().min(1).max(LIM).optional(),
          pular: z.number().int().min(0).optional().describe("Quantos registros pular (paginação)."),
        },
      },
      async (args) => {
        try { return textoJson(await consultar(args)); }
        catch (e) { return textoErro(e); }
      },
    );

    server.registerTool(
      "agregar",
      {
        title: "Somar, contar e agrupar",
        description: "Contagem, soma e média de qualquer tabela, com filtros e agrupamento. Ex.: total de Transacao por tipo no mês, receitas previstas por status, leads por etapa.",
        inputSchema: {
          modelo: z.string(),
          filtros: z.array(filtroSchema).optional(),
          somar: z.string().optional().describe("Campo numérico a somar/média (ex.: valor)."),
          agrupar_por: z.array(z.string()).optional().describe("Campos para agrupar (ex.: tipo, tipo_negocio, status)."),
        },
      },
      async (args) => {
        try { return textoJson(await agregar(args)); }
        catch (e) { return textoErro(e); }
      },
    );
  },
  {},
  {
    // Mantém o mount num caminho literal (/api/mcp) em vez do padrão
    // app/[transport]/route.ts do quick start — mais simples pra um único
    // endpoint. basePath tem que ficar de fora: passar "" ainda entra no
    // branch que *deriva* os endpoints a partir dele (vira "/mcp" de novo,
    // ignorando o valor explícito abaixo). disableSse: não precisamos do
    // transporte antigo por SSE nem do Redis que ele exigiria em produção.
    streamableHttpEndpoint: "/api/mcp",
    disableSse: true,
    maxDuration: 30,
    verboseLogs: false,
  },
);

function autenticar(req: NextRequest): NextResponse | null {
  if (!process.env.MCP_SECRET) {
    console.error("[MCP] MCP_SECRET não configurado — recusando todas as chamadas.");
    return NextResponse.json({ error: "Servidor MCP não configurado" }, { status: 500 });
  }
  // Aceita o segredo estático (clientes via header) ou um token OAuth (Claude.ai).
  if (!bearerValido(req.headers.get("authorization"))) {
    return NextResponse.json(
      { error: "Não autorizado" },
      {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${origem(req)}/.well-known/oauth-protected-resource/api/mcp"` },
      },
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  const negado = autenticar(req);
  if (negado) return negado;
  return handler(req);
}

export async function GET(req: NextRequest) {
  const negado = autenticar(req);
  if (negado) return negado;
  return handler(req);
}
