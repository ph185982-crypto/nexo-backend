-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "encerradoEm" TIMESTAMP(3),
ADD COLUMN     "etapaDesdeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "motivoDetalhe" TEXT,
ADD COLUMN     "motivoEncerramentoId" TEXT;

-- CreateTable
CREATE TABLE "LeadStageHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromColumnId" TEXT,
    "fromName" TEXT,
    "toColumnId" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "origem" TEXT NOT NULL,
    "ator" TEXT,
    "motivo" TEXT,

    CONSTRAINT "LeadStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivoEncerramento" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotivoEncerramento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStageHistory_leadId_enteredAt_idx" ON "LeadStageHistory"("leadId", "enteredAt");

-- CreateIndex
CREATE INDEX "LeadStageHistory_toColumnId_enteredAt_idx" ON "LeadStageHistory"("toColumnId", "enteredAt");

-- CreateIndex
CREATE INDEX "LeadStageHistory_toType_enteredAt_idx" ON "LeadStageHistory"("toType", "enteredAt");

-- CreateIndex
CREATE INDEX "MotivoEncerramento_organizationId_tipo_ativo_idx" ON "MotivoEncerramento"("organizationId", "tipo", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "MotivoEncerramento_organizationId_tipo_nome_key" ON "MotivoEncerramento"("organizationId", "tipo", "nome");

-- CreateIndex
CREATE INDEX "Lead_motivoEncerramentoId_idx" ON "Lead"("motivoEncerramentoId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_motivoEncerramentoId_fkey" FOREIGN KEY ("motivoEncerramentoId") REFERENCES "MotivoEncerramento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageHistory" ADD CONSTRAINT "LeadStageHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preenchimento dos leads que já existem: uma linha por lead, na etapa atual.
-- A data real de entrada não foi gravada até hoje; usa a última mudança de
-- etapa registrada em LeadActivity (STATUS_CHANGE) ou, na falta, a criação do
-- lead. origem = 'BACKFILL' marca essas linhas como aproximadas.
-- Uma única varredura agrupada de LeadActivity (a tabela não tem índice em leadId: uma subconsulta
-- correlacionada por lead varreria a tabela inteira para cada lead).
UPDATE "Lead" SET "etapaDesdeEm" = "createdAt";

UPDATE "Lead" l
SET "etapaDesdeEm" = u."ultima"
FROM (
  SELECT "leadId", MAX("createdAt") AS "ultima"
  FROM "LeadActivity"
  WHERE "type" = 'STATUS_CHANGE'
  GROUP BY "leadId"
) u
WHERE u."leadId" = l."id";

INSERT INTO "LeadStageHistory" ("id", "leadId", "toColumnId", "toName", "toType", "enteredAt", "origem")
SELECT 'bf_' || l."id", l."id", c."id", c."name", c."type", l."etapaDesdeEm", 'BACKFILL'
FROM "Lead" l
JOIN "KanbanColumn" c ON c."id" = l."kanbanColumnId";

-- Leads já parados em etapa final contam como encerrados desde a entrada nela.
UPDATE "Lead" l
SET "encerradoEm" = l."etapaDesdeEm"
FROM "KanbanColumn" c
WHERE c."id" = l."kanbanColumnId" AND c."type" IN ('GANHO', 'LOST', 'DESCARTADO', 'JUNK');
