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
  const segredo = process.env.MCP_SECRET;
  if (!segredo) {
    console.error("[MCP] MCP_SECRET não configurado — recusando todas as chamadas.");
    return NextResponse.json({ error: "Servidor MCP não configurado" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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
