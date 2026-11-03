-- CreateTable
CREATE TABLE "Automacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "gatilho" TEXT NOT NULL,
    "criterios" JSONB NOT NULL DEFAULT '[]',
    "acoes" JSONB NOT NULL DEFAULT '[]',
    "criadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomacaoExecucao" (
    "id" TEXT NOT NULL,
    "automacaoId" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "gatilho" TEXT NOT NULL,
    "indice" INTEGER NOT NULL,
    "acaoTipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "executarEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executadaEm" TIMESTAMP(3),
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomacaoExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Automacao_ativo_gatilho_idx" ON "Automacao"("ativo", "gatilho");

-- CreateIndex
CREATE UNIQUE INDEX "AutomacaoExecucao_chave_key" ON "AutomacaoExecucao"("chave");

-- CreateIndex
CREATE INDEX "AutomacaoExecucao_status_executarEm_idx" ON "AutomacaoExecucao"("status", "executarEm");

-- CreateIndex
CREATE INDEX "AutomacaoExecucao_automacaoId_criadoEm_idx" ON "AutomacaoExecucao"("automacaoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "AutomacaoExecucao" ADD CONSTRAINT "AutomacaoExecucao_automacaoId_fkey" FOREIGN KEY ("automacaoId") REFERENCES "Automacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
