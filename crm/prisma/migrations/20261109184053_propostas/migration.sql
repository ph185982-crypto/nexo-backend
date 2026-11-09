-- CreateTable
CREATE TABLE "Proposta" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "titulo" TEXT NOT NULL,
    "introducao" TEXT NOT NULL,
    "condicoes" TEXT NOT NULL,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "valorUnico" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valorMensal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "validaAte" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3),
    "visualizadaEm" TIMESTAMP(3),
    "respondidaEm" TIMESTAMP(3),
    "respostaNome" TEXT,
    "respostaComentario" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposta_numero_key" ON "Proposta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Proposta_token_key" ON "Proposta"("token");

-- CreateIndex
CREATE INDEX "Proposta_oportunidadeId_versao_idx" ON "Proposta"("oportunidadeId", "versao");

-- AddForeignKey
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
