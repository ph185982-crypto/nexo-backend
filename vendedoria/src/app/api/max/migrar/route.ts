import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export const maxDuration = 300;

const TABLE_MAP: Record<
  string,
  {
    model: string;
    dateFields: string[];
    floatFields?: string[];
    rename?: Record<string, string>;
  }
> = {
  transacoes: {
    model: "transacao",
    dateFields: ["data_transacao", "criado_em"],
    floatFields: ["valor"],
  },
  conversas: {
    model: "conversaMax",
    dateFields: ["criado_em"],
    rename: { content: "content" },
  },
  contexto_pedro: {
    model: "contextoPedro",
    dateFields: ["atualizado_em"],
  },
  lembretes: {
    model: "lembreteMax",
    dateFields: ["data_hora", "criado_em"],
  },
  dividas: {
    model: "dividaMax",
    dateFields: ["criado_em"],
    floatFields: ["valor_total", "valor_pago", "parcela_mensal"],
  },
  metas_financeiras: {
    model: "metaFinanceiraMax",
    dateFields: ["data_inicio", "data_fim", "criado_em"],
    floatFields: ["valor_alvo", "valor_atual"],
  },
  receitas_previstas: {
    model: "receitaPrevistaMax",
    dateFields: ["data_prevista", "data_recebimento", "criado_em"],
    floatFields: ["valor"],
  },
  tarefas: {
    model: "tarefaMax",
    dateFields: ["proxima_cobranca", "criado_em"],
  },
  alertas_enviados: {
    model: "alertaEnviadoMax",
    dateFields: ["enviado_em"],
  },
  contas_pagar: {
    model: "contaPagarMax",
    dateFields: ["data_vencimento", "criado_em"],
    floatFields: ["valor"],
  },
  orcamentos: {
    model: "orcamentoMax",
    dateFields: ["criado_em"],
    floatFields: ["limite_mensal"],
  },
  webhook_events: {
    model: "webhookEventMax",
    dateFields: ["criado_em"],
  },
};

async function supaQuery(token: string, sql: string) {
  const res = await fetch(
    "https://api.supabase.com/v1/projects/dzkfwttquhjudsryqhyu/database/query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalizeRow(
  row: Record<string, unknown>,
  config: (typeof TABLE_MAP)[string]
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const mappedKey = config.rename?.[key] ?? key;

    if (config.dateFields.includes(mappedKey)) {
      normalized[mappedKey] = value != null ? new Date(value as string) : null;
    } else if (config.floatFields?.includes(mappedKey)) {
      if (value != null) {
        const num = typeof value === "string" ? parseFloat(value) : (value as number);
        normalized[mappedKey] = Math.round(num * 100) / 100;
      } else {
        normalized[mappedKey] = null;
      }
    } else {
      normalized[mappedKey] = value;
    }
  }

  return normalized;
}

export async function POST(req: NextRequest) {
  // Auth: Bearer CRON_SECRET
  const authHeader = req.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { supabaseToken, mode, tables } = body as {
      supabaseToken: string;
      mode: "introspect" | "migrate";
      tables?: string[];
    };

    if (!supabaseToken || !mode) {
      return NextResponse.json(
        { error: "supabaseToken and mode are required" },
        { status: 400 }
      );
    }

    const targetTables = tables ?? Object.keys(TABLE_MAP);
    const validTables = targetTables.filter((t) => t in TABLE_MAP);

    if (validTables.length === 0) {
      return NextResponse.json(
        { error: "No valid tables specified" },
        { status: 400 }
      );
    }

    if (mode === "introspect") {
      const schema: Record<string, unknown> = {};
      for (const table of validTables) {
        const cols = await supaQuery(
          supabaseToken,
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_name = '${table}'
           ORDER BY ordinal_position`
        );
        schema[table] = cols;
      }
      return NextResponse.json({ mode: "introspect", schema });
    }

    // mode === "migrate"
    const summary: Record<
      string,
      {
        source_count: number;
        inserted: number;
        skipped: number;
        checksum?: number;
      }
    > = {};

    for (const table of validTables) {
      const config = TABLE_MAP[table];

      // Count source rows
      const countResult = await supaQuery(
        supabaseToken,
        `SELECT count(*)::int as cnt FROM ${table}`
      );
      const sourceCount = countResult[0]?.cnt ?? 0;

      let totalInserted = 0;
      let totalSkipped = 0;
      let checksum = 0;
      const PAGE_SIZE = 200;

      for (let offset = 0; offset < sourceCount; offset += PAGE_SIZE) {
        const rows = await supaQuery(
          supabaseToken,
          `SELECT * FROM ${table} ORDER BY id LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );

        if (!Array.isArray(rows) || rows.length === 0) break;

        const normalizedRows = rows.map((row: Record<string, unknown>) =>
          normalizeRow(row, config)
        );

        // Accumulate checksum for money tables
        if (config.floatFields) {
          for (const row of normalizedRows) {
            for (const field of config.floatFields) {
              if (row[field] != null) {
                checksum += row[field] as number;
              }
            }
          }
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (prisma as any)[config.model].createMany({
            data: normalizedRows,
            skipDuplicates: true,
          });
          totalInserted += result.count;
          totalSkipped += normalizedRows.length - result.count;
        } catch (err) {
          console.error(`[migrar] Error inserting into ${config.model}:`, err);
          totalSkipped += normalizedRows.length;
        }
      }

      summary[table] = {
        source_count: sourceCount,
        inserted: totalInserted,
        skipped: totalSkipped,
        ...(config.floatFields
          ? { checksum: Math.round(checksum * 100) / 100 }
          : {}),
      };
    }

    return NextResponse.json({ mode: "migrate", summary });
  } catch (err: unknown) {
    console.error("[max/migrar]", err);
    return NextResponse.json(
      {
        error: "Migration failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
