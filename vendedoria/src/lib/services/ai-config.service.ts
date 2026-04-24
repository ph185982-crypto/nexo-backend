import { prisma } from "@/lib/prisma/client";
// z.output<> resolves defaults to non-optional — use it for service parameter types
import type { z } from "zod";
import type {
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  StrategyCreateSchema,
  StrategyUpdateSchema,
  ObjectionCreateSchema,
  ObjectionUpdateSchema,
  ConstraintCreateSchema,
  ConstraintUpdateSchema,
  FollowUpSettingsSchema,
} from "@/lib/schemas/ai-config";

type PersonalityCreate  = z.output<typeof PersonalityCreateSchema>;
type PersonalityUpdate  = z.output<typeof PersonalityUpdateSchema>;
type StrategyCreate     = z.output<typeof StrategyCreateSchema>;
type StrategyUpdate     = z.output<typeof StrategyUpdateSchema>;
type ObjectionCreate    = z.output<typeof ObjectionCreateSchema>;
type ObjectionUpdate    = z.output<typeof ObjectionUpdateSchema>;
type ConstraintCreate   = z.output<typeof ConstraintCreateSchema>;
type ConstraintUpdate   = z.output<typeof ConstraintUpdateSchema>;
type FollowUpSettings   = z.output<typeof FollowUpSettingsSchema>;

// ─── Versioning ───────────────────────────────────────────────────────────────
// Every mutating operation calls this to snapshot the current full config.
// The PromptCompiler can read the active version instead of live rows,
// ensuring conversations in-flight are never disrupted by config changes.

async function snapshotActiveConfig(changeNote: string): Promise<void> {
  try {
    const [personality, strategy, constraints, objections, agentConfig] = await Promise.all([
      prisma.personalityProfile.findMany({ where: { isActive: true } }),
      prisma.strategyProfile.findMany({ where: { isActive: true } }),
      prisma.constraintRule.findMany({ where: { isActive: true } }),
      prisma.objectionRule.findMany({ where: { isActive: true } }),
      prisma.agentConfig.findFirst(),
    ]);

    // Determine next version number
    const latest = await prisma.agentConfigVersion.findFirst({ orderBy: { version: "desc" } });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Deactivate previous version and create new one in a transaction
    await prisma.$transaction([
      prisma.agentConfigVersion.updateMany({ where: { isActive: true }, data: { isActive: false } }),
      prisma.agentConfigVersion.create({
        data: {
          version: nextVersion,
          isActive: true,
          changeNote,
          personalitySnapshot: personality as object[],
          strategySnapshot:    strategy as object[],
          constraintsSnapshot: constraints as object[],
          objectionsSnapshot:  objections as object[],
          followUpSnapshot: {
            maxFollowUps:  agentConfig?.maxFollowUps  ?? 4,
            followUpHours: agentConfig?.followUpHours ?? "4,24,48,72",
            followUpPrompt: agentConfig?.followUpPrompt ?? null,
          },
        },
      }),
    ]);

    console.log(`[AiConfigService] New version ${nextVersion} created — ${changeNote}`);
  } catch (err) {
    // Versioning failure must never break the main mutation
    console.error("[AiConfigService] Snapshot failed (non-fatal):", err);
  }
}

// ─── Personality ──────────────────────────────────────────────────────────────

export const PersonalityService = {
  async list() {
    return prisma.personalityProfile.findMany({ orderBy: { createdAt: "asc" } });
  },

  async create(data: PersonalityCreate) {
    const record = await prisma.personalityProfile.create({
      data: { ...data, emoji: data.emoji ?? "👤", isActive: data.isActive ?? true },
    });
    await snapshotActiveConfig(`personality created: ${data.name}`);
    return record;
  },

  async update(id: string, data: PersonalityUpdate) {
    const record = await prisma.personalityProfile.update({ where: { id }, data });
    await snapshotActiveConfig(`personality updated: ${record.name}`);
    return record;
  },

  async remove(id: string) {
    // Unlink from AgentConfig first to avoid FK violation
    await prisma.agentConfig.updateMany({
      where: { personalityProfileId: id },
      data:  { personalityProfileId: null },
    });
    const record = await prisma.personalityProfile.delete({ where: { id } });
    await snapshotActiveConfig(`personality deleted: ${record.name}`);
    return record;
  },

  async setActive(agentConfigId: string, personalityProfileId: string | null) {
    const record = await prisma.agentConfig.update({
      where: { id: agentConfigId },
      data:  { personalityProfileId },
      include: { personalityProfile: true },
    });
    await snapshotActiveConfig(
      personalityProfileId
        ? `active personality set to: ${record.personalityProfile?.name}`
        : "active personality cleared",
    );
    return record;
  },
};

// ─── Strategy ─────────────────────────────────────────────────────────────────

export const StrategyService = {
  async list() {
    return prisma.strategyProfile.findMany({ orderBy: { createdAt: "asc" } });
  },

  async create(data: StrategyCreate) {
    const record = await prisma.strategyProfile.create({
      data: { ...data, urgency: data.urgency ?? "medium", isActive: data.isActive ?? true },
    });
    await snapshotActiveConfig(`strategy created: ${data.name}`);
    return record;
  },

  async update(id: string, data: StrategyUpdate) {
    const record = await prisma.strategyProfile.update({ where: { id }, data });
    await snapshotActiveConfig(`strategy updated: ${record.name}`);
    return record;
  },

  async remove(id: string) {
    await prisma.agentConfig.updateMany({
      where: { strategyProfileId: id },
      data:  { strategyProfileId: null },
    });
    const record = await prisma.strategyProfile.delete({ where: { id } });
    await snapshotActiveConfig(`strategy deleted: ${record.name}`);
    return record;
  },

  async setActive(agentConfigId: string, strategyProfileId: string | null) {
    const record = await prisma.agentConfig.update({
      where: { id: agentConfigId },
      data:  { strategyProfileId },
      include: { strategyProfile: true },
    });
    await snapshotActiveConfig(
      strategyProfileId
        ? `active strategy set to: ${record.strategyProfile?.name}`
        : "active strategy cleared",
    );
    return record;
  },
};

// ─── ObjectionRule ────────────────────────────────────────────────────────────

export const ObjectionService = {
  async list(onlyActive = false) {
    return prisma.objectionRule.findMany({
      where:   onlyActive ? { isActive: true } : undefined,
      orderBy: { keyword: "asc" },
    });
  },

  async getById(id: string) {
    return prisma.objectionRule.findUnique({ where: { id } });
  },

  async create(data: ObjectionCreate) {
    const record = await prisma.objectionRule.create({
      data: { ...data, isActive: data.isActive ?? true },
    });
    await snapshotActiveConfig(`objection rule created: keyword=${data.keyword}`);
    return record;
  },

  async update(id: string, data: ObjectionUpdate) {
    const record = await prisma.objectionRule.update({ where: { id }, data });
    await snapshotActiveConfig(`objection rule updated: ${record.keyword}`);
    return record;
  },

  async remove(id: string) {
    const record = await prisma.objectionRule.delete({ where: { id } });
    await snapshotActiveConfig(`objection rule deleted: ${record.keyword}`);
    return record;
  },
};

// ─── ConstraintRule ───────────────────────────────────────────────────────────

export const ConstraintService = {
  async list(onlyActive = false) {
    return prisma.constraintRule.findMany({
      where:   onlyActive ? { isActive: true } : undefined,
      orderBy: { createdAt: "asc" },
    });
  },

  async getById(id: string) {
    return prisma.constraintRule.findUnique({ where: { id } });
  },

  async create(data: ConstraintCreate) {
    const record = await prisma.constraintRule.create({
      data: { ...data, isActive: data.isActive ?? true },
    });
    await snapshotActiveConfig(`constraint created: ${data.title}`);
    return record;
  },

  async update(id: string, data: ConstraintUpdate) {
    const record = await prisma.constraintRule.update({ where: { id }, data });
    await snapshotActiveConfig(`constraint updated: ${record.title}`);
    return record;
  },

  async remove(id: string) {
    const record = await prisma.constraintRule.delete({ where: { id } });
    await snapshotActiveConfig(`constraint deleted: ${record.title}`);
    return record;
  },
};

// ─── FollowUp Settings ────────────────────────────────────────────────────────

export const FollowUpService = {
  async get() {
    const cfg = await prisma.agentConfig.findFirst({
      select: { id: true, maxFollowUps: true, followUpHours: true, followUpPrompt: true },
    });
    return cfg;
  },

  async update(data: FollowUpSettings) {
    const cfg = await prisma.agentConfig.findFirst();
    if (!cfg) throw new Error("AgentConfig não encontrado — execute o setup inicial");

    // Validate interval count matches maxFollowUps
    const intervals = data.followUpHours.split(",").map(Number);
    if (intervals.length < data.maxFollowUps) {
      throw new Error(
        `followUpHours tem ${intervals.length} intervalos mas maxFollowUps=${data.maxFollowUps}. Adicione mais intervalos.`,
      );
    }

    const record = await prisma.agentConfig.update({
      where: { id: cfg.id },
      data: {
        maxFollowUps:  data.maxFollowUps,
        followUpHours: data.followUpHours,
        followUpPrompt: data.followUpPrompt,
      },
      select: { id: true, maxFollowUps: true, followUpHours: true, followUpPrompt: true },
    });

    await snapshotActiveConfig(
      `follow-up settings updated: max=${data.maxFollowUps} intervals=${data.followUpHours}`,
    );
    return record;
  },
};

// ─── Version history ──────────────────────────────────────────────────────────

export const VersionService = {
  async list(take = 20) {
    return prisma.agentConfigVersion.findMany({
      orderBy: { version: "desc" },
      take,
      select: {
        id: true, version: true, isActive: true, changeNote: true, createdAt: true,
        // omit large JSON snapshots from the list view
        personalitySnapshot: false,
        strategySnapshot:    false,
        constraintsSnapshot: false,
        objectionsSnapshot:  false,
        followUpSnapshot:    false,
      },
    });
  },

  async getById(id: string) {
    return prisma.agentConfigVersion.findUnique({ where: { id } });
  },

  async getActive() {
    return prisma.agentConfigVersion.findFirst({ where: { isActive: true } });
  },
};
