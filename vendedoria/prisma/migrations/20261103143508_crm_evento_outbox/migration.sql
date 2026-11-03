-- CreateTable
CREATE TABLE "CrmEventoOutbox" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),

    CONSTRAINT "CrmEventoOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmEventoOutbox_eventoId_key" ON "CrmEventoOutbox"("eventoId");

-- CreateIndex
CREATE INDEX "CrmEventoOutbox_status_proximaTentativaEm_idx" ON "CrmEventoOutbox"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "CrmEventoOutbox_leadId_criadoEm_idx" ON "CrmEventoOutbox"("leadId", "criadoEm");
