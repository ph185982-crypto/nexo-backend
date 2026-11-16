-- Contratos no Comercial (Etapa 3, F4/C8–C9): contrato emitido, arquivos (PDF em bytea + sha256),
-- eventos da ClickSign (idempotentes) e outbox de eventos para a Central. Aditiva: só CREATE TABLE/INDEX e FKs novas.

-- CreateTable
CREATE TABLE "contrato_emitido" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "contatoId" TEXT,
    "leadId" TEXT,
    "modelo" TEXT NOT NULL,
    "plano" TEXT,
    "marca" TEXT NOT NULL DEFAULT 'avanteza',
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cnpj" TEXT,
    "representante" TEXT,
    "emailCliente" TEXT,
    "telefoneCliente" TEXT,
    "valor" DECIMAL(14,2),
    "duracaoMeses" INTEGER,
    "inicioEm" TIMESTAMP(3),
    "vencimentoDia" INTEGER,
    "filename" TEXT NOT NULL,
    "formJson" JSONB NOT NULL,
    "substituiId" TEXT,
    "provedor" TEXT NOT NULL DEFAULT 'clicksign',
    "envelopeId" TEXT,
    "documentoId" TEXT,
    "pastaClicksign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GERADO',
    "ultimoErro" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "assinadoEm" TIMESTAMP(3),
    "automatizadoEm" TIMESTAMP(3),
    "origem" TEXT NOT NULL DEFAULT 'APP',
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contrato_emitido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrato_arquivo" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contrato_arquivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrato_evento" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT,
    "envelopeId" TEXT,
    "tipo" TEXT NOT NULL,
    "eventoExternoId" TEXT,
    "payload" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contrato_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_evento_outbox" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),

    CONSTRAINT "central_evento_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contrato_emitido_envelopeId_key" ON "contrato_emitido"("envelopeId");

-- CreateIndex
CREATE INDEX "contrato_emitido_oportunidadeId_idx" ON "contrato_emitido"("oportunidadeId");

-- CreateIndex
CREATE INDEX "contrato_emitido_status_criadoEm_idx" ON "contrato_emitido"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "contrato_emitido_documentoId_idx" ON "contrato_emitido"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "contrato_arquivo_contratoId_tipo_key" ON "contrato_arquivo"("contratoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "contrato_evento_eventoExternoId_key" ON "contrato_evento"("eventoExternoId");

-- CreateIndex
CREATE INDEX "contrato_evento_contratoId_recebidoEm_idx" ON "contrato_evento"("contratoId", "recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "central_evento_outbox_eventoId_key" ON "central_evento_outbox"("eventoId");

-- CreateIndex
CREATE INDEX "central_evento_outbox_status_proximaTentativaEm_idx" ON "central_evento_outbox"("status", "proximaTentativaEm");

-- AddForeignKey
ALTER TABLE "contrato_emitido" ADD CONSTRAINT "contrato_emitido_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_emitido" ADD CONSTRAINT "contrato_emitido_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_emitido" ADD CONSTRAINT "contrato_emitido_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_arquivo" ADD CONSTRAINT "contrato_arquivo_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contrato_emitido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_evento" ADD CONSTRAINT "contrato_evento_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contrato_emitido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

