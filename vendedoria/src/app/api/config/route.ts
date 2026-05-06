import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";

const DEFAULTS = {
  usarEmoji: true,
  usarReticencias: true,
  nivelVenda: "medio",
  tomDeVoz: "sincero",
  arquetipoIA: null as string | null,
  objetivoVenda: "fechar_venda",
  nivelUrgencia: 3,
  matrizObjecoes: [] as unknown[],
  restricoes: [] as unknown[],
  followUpIntervalos: [4, 24, 48, 72] as unknown,
  followUpMaxTentativas: 4,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const config = await prisma.aiConfig.findUnique({ where: { organizationId } });
  return NextResponse.json(config ?? { organizationId, ...DEFAULTS });
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as {
    organizationId: string;
    usarEmoji?: boolean;
    usarReticencias?: boolean;
    nivelVenda?: string;
    tomDeVoz?: string;
    arquetipoIA?: string | null;
    objetivoVenda?: string;
    nivelUrgencia?: number;
    matrizObjecoes?: unknown[];
    restricoes?: unknown[];
    followUpIntervalos?: number[];
    followUpMaxTentativas?: number;
    savedBy?: string;
    label?: string;
  };

  const { organizationId, savedBy, label, ...data } = body;
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const config = await prisma.aiConfig.upsert({
    where: { organizationId },
    update: data as unknown as Prisma.AiConfigUpdateInput,
    create: { organizationId, ...DEFAULTS, ...data } as unknown as Prisma.AiConfigCreateInput,
  });

  // ── Cria AgentConfigVersion imutável — snapshot do estado atual ────────────
  // Encontra o agente associado à organização (via providerConfig → agent)
  try {
    const account = await prisma.whatsappProviderConfig.findFirst({
      where: { organizationId },
      include: { agent: { select: { id: true, systemPrompt: true } } },
    });
    if (account?.agent) {
      await prisma.agentConfigVersion.create({
        data: {
          agentId:              account.agent.id,
          systemPrompt:         account.agent.systemPrompt,
          nivelVenda:           config.nivelVenda,
          usarEmoji:            config.usarEmoji,
          usarReticencias:      config.usarReticencias,
          tomDeVoz:             config.tomDeVoz,
          arquetipoIA:          config.arquetipoIA,
          objetivoVenda:        config.objetivoVenda,
          nivelUrgencia:        config.nivelUrgencia,
          matrizObjecoes:       config.matrizObjecoes as Prisma.InputJsonValue,
          restricoes:           config.restricoes as Prisma.InputJsonValue,
          followUpIntervalos:   config.followUpIntervalos as Prisma.InputJsonValue,
          followUpMaxTentativas: config.followUpMaxTentativas,
          savedBy:              savedBy ?? "dashboard",
          label:                label ?? null,
        },
      });

      // Keep only last 20 versions
      const old = await prisma.agentConfigVersion.findMany({
        where: { agentId: account.agent.id },
        orderBy: { createdAt: "desc" },
        skip: 20,
        select: { id: true },
      });
      if (old.length > 0) {
        await prisma.agentConfigVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
      }
    }
  } catch (e) {
    console.warn("[/api/config] AgentConfigVersion creation failed (non-fatal):", e);
  }

  return NextResponse.json(config);
}
