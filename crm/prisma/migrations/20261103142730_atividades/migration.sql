-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "contatoId" TEXT,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "intencao" TEXT,
    "importante" BOOLEAN NOT NULL DEFAULT false,
    "autor" TEXT,
    "autorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'TAREFA',
    "prioridade" TEXT NOT NULL DEFAULT 'NORMAL',
    "prazoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "concluidaEm" TIMESTAMP(3),
    "recorrencia" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "responsavelId" TEXT,
    "contatoId" TEXT,
    "oportunidadeId" TEXT,
    "paiId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compromisso" (
    "id" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'REUNIAO',
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "local" TEXT,
    "descricao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AGENDADO',
    "participantes" TEXT[],
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "responsavelId" TEXT,
    "contatoId" TEXT,
    "oportunidadeId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compromisso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_oportunidadeId_criadoEm_idx" ON "Feedback"("oportunidadeId", "criadoEm");

-- CreateIndex
CREATE INDEX "Feedback_contatoId_criadoEm_idx" ON "Feedback"("contatoId", "criadoEm");

-- CreateIndex
CREATE INDEX "Feedback_intencao_criadoEm_idx" ON "Feedback"("intencao", "criadoEm");

-- CreateIndex
CREATE INDEX "Tarefa_status_prazoEm_idx" ON "Tarefa"("status", "prazoEm");

-- CreateIndex
CREATE INDEX "Tarefa_responsavelId_status_idx" ON "Tarefa"("responsavelId", "status");

-- CreateIndex
CREATE INDEX "Tarefa_oportunidadeId_status_idx" ON "Tarefa"("oportunidadeId", "status");

-- CreateIndex
CREATE INDEX "Compromisso_inicio_idx" ON "Compromisso"("inicio");

-- CreateIndex
CREATE INDEX "Compromisso_oportunidadeId_status_idx" ON "Compromisso"("oportunidadeId", "status");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromisso" ADD CONSTRAINT "Compromisso_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromisso" ADD CONSTRAINT "Compromisso_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromisso" ADD CONSTRAINT "Compromisso_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
