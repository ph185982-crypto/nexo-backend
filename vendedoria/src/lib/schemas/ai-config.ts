import { z } from "zod";

// ─── PersonalityProfile ───────────────────────────────────────────────────────

export const PersonalityCreateSchema = z.object({
  name: z
    .string()
    .min(2, "Nome deve ter ao menos 2 caracteres")
    .max(50, "Nome deve ter no máximo 50 caracteres")
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/, "Nome deve conter apenas letras"),
  tone: z
    .string()
    .min(20, "Tom deve ter ao menos 20 caracteres — descreva o estilo de comunicação")
    .max(2000, "Tom deve ter no máximo 2000 caracteres"),
  archetype: z.enum(["Vendedor", "Consultor", "Amigo", "Especialista", "Coach"], {
    errorMap: () => ({ message: "Arquétipo inválido. Use: Vendedor, Consultor, Amigo, Especialista ou Coach" }),
  }),
  emoji: z
    .string()
    .min(1, "Emoji obrigatório")
    .max(4, "Máximo 1 emoji")
    .default("👤"),
  isActive: z.boolean().default(true),
});

export const PersonalityUpdateSchema = PersonalityCreateSchema.partial().omit({ name: true });

export type PersonalityCreate = z.infer<typeof PersonalityCreateSchema>;
export type PersonalityUpdate = z.infer<typeof PersonalityUpdateSchema>;

// ─── StrategyProfile ──────────────────────────────────────────────────────────

export const StrategyCreateSchema = z.object({
  name: z
    .string()
    .min(2, "Nome deve ter ao menos 2 caracteres")
    .max(80, "Nome deve ter no máximo 80 caracteres"),
  description: z
    .string()
    .min(10, "Descrição deve ter ao menos 10 caracteres")
    .max(1000, "Descrição deve ter no máximo 1000 caracteres"),
  salesGoal: z
    .string()
    .min(5, "Objetivo de venda deve ter ao menos 5 caracteres")
    .max(200, "Objetivo deve ter no máximo 200 caracteres"),
  urgency: z.enum(["low", "medium", "high"], {
    errorMap: () => ({ message: "Urgência inválida. Use: low, medium ou high" }),
  }).default("medium"),
  isActive: z.boolean().default(true),
});

export const StrategyUpdateSchema = StrategyCreateSchema.partial().omit({ name: true });

export type StrategyCreate = z.infer<typeof StrategyCreateSchema>;
export type StrategyUpdate = z.infer<typeof StrategyUpdateSchema>;

// ─── ObjectionRule ────────────────────────────────────────────────────────────

const OBJECTION_TYPES = ["PRICE", "COMPETITOR", "TIMING", "DISINTEREST", "TRUST", "FEATURE"] as const;

export const ObjectionCreateSchema = z.object({
  keyword: z
    .string()
    .min(2, "Keyword deve ter ao menos 2 caracteres")
    .max(60, "Keyword deve ter no máximo 60 caracteres")
    .toLowerCase()
    .regex(/^[a-záàãâéèêíìîóòõôúùûç_\s]+$/i, "Keyword deve conter apenas letras e underscores"),
  objectionType: z.enum(OBJECTION_TYPES, {
    errorMap: () => ({ message: `Tipo inválido. Use: ${OBJECTION_TYPES.join(", ")}` }),
  }),
  responseStrategy: z
    .string()
    .min(10, "Estratégia de resposta deve ter ao menos 10 caracteres")
    .max(1000, "Estratégia deve ter no máximo 1000 caracteres"),
  counterArgument: z
    .string()
    .min(10, "Contra-argumento deve ter ao menos 10 caracteres")
    .max(1000, "Contra-argumento deve ter no máximo 1000 caracteres"),
  isActive: z.boolean().default(true),
});

export const ObjectionUpdateSchema = ObjectionCreateSchema.partial().omit({ keyword: true });

export type ObjectionCreate = z.infer<typeof ObjectionCreateSchema>;
export type ObjectionUpdate = z.infer<typeof ObjectionUpdateSchema>;

// ─── ConstraintRule ───────────────────────────────────────────────────────────

export const ConstraintCreateSchema = z.object({
  title: z
    .string()
    .min(3, "Título deve ter ao menos 3 caracteres")
    .max(100, "Título deve ter no máximo 100 caracteres"),
  rule: z
    .string()
    .min(10, "Regra deve ter ao menos 10 caracteres")
    .max(500, "Regra deve ter no máximo 500 caracteres"),
  reason: z
    .string()
    .max(300, "Motivo deve ter no máximo 300 caracteres")
    .optional(),
  isActive: z.boolean().default(true),
});

export const ConstraintUpdateSchema = ConstraintCreateSchema.partial();

export type ConstraintCreate = z.infer<typeof ConstraintCreateSchema>;
export type ConstraintUpdate = z.infer<typeof ConstraintUpdateSchema>;

// ─── FollowUp Settings ────────────────────────────────────────────────────────

export const FollowUpSettingsSchema = z.object({
  maxFollowUps: z
    .number()
    .int("Deve ser número inteiro")
    .min(1, "Mínimo 1 follow-up")
    .max(10, "Máximo 10 follow-ups para evitar spam"),
  followUpHours: z
    .string()
    .regex(
      /^(\d+(\.\d+)?)(,(\d+(\.\d+)?))*$/,
      'Formato inválido. Use números separados por vírgula. Ex: "4,24,48,72"',
    )
    .refine(
      (val) => {
        const nums = val.split(",").map(Number);
        return nums.every((n) => n >= 0.5 && n <= 168);
      },
      "Cada intervalo deve estar entre 0.5h e 168h (1 semana)",
    )
    .refine(
      (val) => {
        const nums = val.split(",").map(Number);
        // Must be strictly increasing
        return nums.every((n, i) => i === 0 || n > nums[i - 1]);
      },
      "Intervalos devem ser crescentes (ex: 4,24,48,72)",
    ),
  followUpPrompt: z
    .string()
    .max(3000, "Prompt de follow-up deve ter no máximo 3000 caracteres")
    .optional()
    .nullable(),
}).refine(
  (data) => data.followUpHours.split(",").length >= data.maxFollowUps,
  {
    message: "Quantidade de intervalos deve ser >= maxFollowUps",
    path: ["followUpHours"],
  },
);

export type FollowUpSettings = z.infer<typeof FollowUpSettingsSchema>;

// ─── Agent active profile assignment ─────────────────────────────────────────

export const AgentActiveProfileSchema = z.object({
  personalityProfileId: z.string().cuid("ID inválido").optional().nullable(),
  strategyProfileId:    z.string().cuid("ID inválido").optional().nullable(),
});

export type AgentActiveProfile = z.infer<typeof AgentActiveProfileSchema>;

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** Parses body with a Zod schema; returns {data} or {error, issues} */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): { data: z.output<S> } | { error: string; issues: z.ZodIssue[] } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: "Dados inválidos",
      issues: result.error.issues,
    };
  }
  return { data: result.data as z.output<S> };
}
