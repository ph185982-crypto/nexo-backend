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
    let body: Record<string, unknown> = {};
    try { body = await req.json() as Record<string, unknown>; } catch { /* sem body */ }
    const mode = (body.mode as "introspect" | "migrate" | undefined) ?? "migrate";
    const tables = body.tables as string[] | undefined;

    // Token: do body OU do banco (IntegrationCredential "SUPABASE", injetado
    // via /api/integrations/supabase/token — nunca commitado no repo)
    let supabaseToken = (body.supabaseToken as string | undefined)?.trim();
    if (!supabaseToken) {
      const cred = await prisma.integrationCredential.findUnique({
        where: { provider: "SUPABASE" },
        select: { refreshToken: true },
      }).catch(() => null);
      supabaseToken = cred?.refreshToken;
    }

    if (!supabaseToken) {
      return NextResponse.json(
        { error: "supabaseToken ausente (envie no body ou configure via /api/integrations/supabase/token)" },
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
        db_count?: number;
        checksum?: number;
        dropped_columns?: string[];
        error?: string;
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
      let lastError: string | undefined;
      const droppedColumns = new Set<string>();
      const PAGE_SIZE = 200;

      for (let offset = 0; offset < sourceCount; offset += PAGE_SIZE) {
        const rows = await supaQuery(
          supabaseToken,
          `SELECT * FROM ${table} ORDER BY id LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );

        if (!Array.isArray(rows) || rows.length === 0) break;

        let normalizedRows = rows.map((row: Record<string, unknown>) =>
          normalizeRow(row, config)
        );
        // Colunas já identificadas como inexistentes no modelo Prisma
        for (const col of droppedColumns) {
          normalizedRows = normalizedRows.map((r) => { delete r[col]; return r; });
        }

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

        // Autocorreção: se o Prisma rejeitar uma coluna desconhecida
        // ("Unknown argument `x`"), remove a coluna e tenta de novo.
        let inserted = false;
        for (let tentativa = 0; tentativa < 10 && !inserted; tentativa++) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (prisma as any)[config.model].createMany({
              data: normalizedRows,
              skipDuplicates: true,
            });
            totalInserted += result.count;
            totalSkipped += normalizedRows.length - result.count;
            inserted = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const unknownArg = msg.match(/Unknown argument `(\w+)`/);
            if (unknownArg) {
              const col = unknownArg[1];
              droppedColumns.add(col);
              normalizedRows = normalizedRows.map((r) => { delete r[col]; return r; });
              console.warn(`[migrar] ${table}: coluna desconhecida "${col}" removida — retry`);
              continue;
            }
            lastError = msg.replace(/\n/g, " ").slice(0, 300);
            console.error(`[migrar] Error inserting into ${config.model}:`, msg.slice(0, 500));
            totalSkipped += normalizedRows.length;
            break;
          }
        }
      }

      // Contagem real no banco de destino — prova definitiva da migração
      let dbCount: number | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dbCount = await (prisma as any)[config.model].count();
      } catch { /* ignore */ }

      summary[table] = {
        source_count: sourceCount,
        inserted: totalInserted,
        skipped: totalSkipped,
        ...(dbCount !== undefined ? { db_count: dbCount } : {}),
        ...(config.floatFields
          ? { checksum: Math.round(checksum * 100) / 100 }
          : {}),
        ...(droppedColumns.size > 0 ? { dropped_columns: [...droppedColumns] } : {}),
        ...(lastError ? { error: lastError } : {}),
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
