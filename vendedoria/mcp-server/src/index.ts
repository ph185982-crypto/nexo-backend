#!/usr/bin/env node
// Servidor MCP do nexo-vendedoria — dá a qualquer agente compatível com MCP
// (Claude Desktop, Claude Code, outro agente) acesso de leitura e edição ao
// sistema inteiro, através de duas ferramentas genéricas que embrulham as
// APIs que já existem no app:
//
//   - nexo_graphql   → POST /api/graphql   (leads, conversas, mensagens,
//                       campanhas, agenda, agente IA, organização — o mesmo
//                       schema que o próprio CRM usa)
//   - nexo_rest      → qualquer rota REST protegida por chave de API,
//                       principalmente /api/prospeccao/* (buscas, empresas,
//                       pipeline de qualificação, disparo)
//
// Autenticação: variável de ambiente NEXO_API_KEY (crie em Configurações →
// API dentro do CRM). Alvo: NEXO_API_BASE_URL (ex.: https://nexo-vendedoria.vercel.app).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const BASE_URL = (process.env.NEXO_API_BASE_URL ?? "https://nexo-vendedoria.vercel.app").replace(/\/+$/, "");
const API_KEY = process.env.NEXO_API_KEY;

if (!API_KEY) {
  console.error(
    "[nexo-vendedoria-mcp] NEXO_API_KEY não definida. Crie uma chave em " +
      "Configurações → API no CRM e passe como variável de ambiente.",
  );
  process.exit(1);
}

async function chamar(path: string, init: RequestInit = {}): Promise<{ status: number; corpo: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  let corpo: unknown = texto;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON (ex.: planilha) */ }
  return { status: res.status, corpo };
}

const ferramentas: Array<{
  tool: Tool;
  schema: z.ZodTypeAny;
  executar: (args: Record<string, unknown>) => Promise<{ status: number; corpo: unknown }>;
}> = [
  {
    tool: {
      name: "nexo_graphql",
      description:
        "Executa uma query ou mutation GraphQL no nexo-vendedoria. Cobre leads, conversas do WhatsApp, " +
        "mensagens, campanhas, calendário, profissionais/unidades, agente de IA e organização/contas — " +
        "o mesmo schema usado pelo próprio CRM. Use introspection (query { __schema { ... } }) se precisar " +
        "descobrir os campos disponíveis; a introspecção fica ligada fora de produção, então se vier vazia " +
        "peça ao usuário o schema ou consulte a documentação do repositório (src/graphql/schema/typeDefs.ts).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Documento GraphQL (query ou mutation)." },
          variables: { type: "object", description: "Variáveis da query, se houver.", additionalProperties: true },
        },
        required: ["query"],
      },
    },
    schema: z.object({ query: z.string(), variables: z.record(z.unknown()).optional() }),
    executar: async (args) => chamar("/api/graphql", { method: "POST", body: JSON.stringify(args) }),
  },
  {
    tool: {
      name: "nexo_rest",
      description:
        "Chama uma rota REST do nexo-vendedoria protegida por chave de API. Principal uso: " +
        "/api/prospeccao/* — resumo do funil, listar/filtrar empresas, ver detalhe, aprovar/descartar em " +
        "massa, criar e editar buscas (segmentos), rodar o pipeline de qualificação, disparo. Caminhos " +
        "úteis: GET /api/prospeccao/resumo/{orgId}, GET /api/prospeccao/empresas?orgId=..., " +
        "GET/PATCH /api/prospeccao/empresas/{id}, POST /api/prospeccao/empresas/acoes, " +
        "GET/POST /api/prospeccao/segmentos, PATCH/DELETE /api/prospeccao/segmentos/{id}, " +
        "POST /api/prospeccao/pipeline/{segmentId}, GET /api/prospeccao/orgs.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PATCH", "DELETE"], description: "Método HTTP." },
          path: { type: "string", description: "Caminho a partir da raiz, ex.: /api/prospeccao/orgs" },
          body: { type: "object", description: "Corpo JSON (para POST/PATCH).", additionalProperties: true },
        },
        required: ["method", "path"],
      },
    },
    schema: z.object({
      method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
      path: z.string().startsWith("/"),
      body: z.record(z.unknown()).optional(),
    }),
    executar: async (args) => {
      const { method, path, body } = args as { method: string; path: string; body?: unknown };
      return chamar(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    },
  },
];

const server = new Server(
  { name: "nexo-vendedoria", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ferramentas.map((f) => f.tool),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const alvo = ferramentas.find((f) => f.tool.name === req.params.name);
  if (!alvo) {
    return { isError: true, content: [{ type: "text", text: `Ferramenta desconhecida: ${req.params.name}` }] };
  }
  const parsed = alvo.schema.safeParse(req.params.arguments ?? {});
  if (!parsed.success) {
    return { isError: true, content: [{ type: "text", text: `Argumentos inválidos: ${parsed.error.message}` }] };
  }
  try {
    const { status, corpo } = await alvo.executar(parsed.data as Record<string, unknown>);
    return {
      isError: status >= 400,
      content: [{ type: "text", text: JSON.stringify({ status, corpo }, null, 2) }],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Falha na chamada: ${e instanceof Error ? e.message : String(e)}` }] };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[nexo-vendedoria-mcp] conectado — alvo ${BASE_URL}`);
