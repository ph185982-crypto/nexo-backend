-- CreateTable
CREATE TABLE "Combinado" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ENTREGAVEL',
    "responsavel" TEXT NOT NULL DEFAULT 'NOS',
    "prazoEm" TIMESTAMP(3),
    "pilar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGERIDO',
    "acao" TEXT NOT NULL DEFAULT 'NOVO',
    "alvoCombinadoId" TEXT,
    "alvoCartaoId" TEXT,
    "evidencia" TEXT,
    "confianca" DOUBLE PRECISION,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "analiseId" TEXT,
    "cartaoId" TEXT,
    "tarefaId" TEXT,
    "compromissoId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "decididoPorId" TEXT,
    "entregueEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combinado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnaliseAgente" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "fonteRef" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "resumo" TEXT,
    "erro" TEXT,
    "sugestoes" INTEGER NOT NULL DEFAULT 0,
    "modelo" TEXT,
    "tokensEntrada" INTEGER,
    "tokensSaida" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "AnaliseAgente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensagem" (
    "id" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "autor" TEXT NOT NULL,
    "deMim" BOOLEAN NOT NULL,
    "texto" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3) NOT NULL,
    "origem" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Combinado_oportunidadeId_status_idx" ON "Combinado"("oportunidadeId", "status");

-- CreateIndex
CREATE INDEX "Combinado_analiseId_idx" ON "Combinado"("analiseId");

-- CreateIndex
CREATE INDEX "AnaliseAgente_status_criadoEm_idx" ON "AnaliseAgente"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "AnaliseAgente_oportunidadeId_fonte_fonteRef_key" ON "AnaliseAgente"("oportunidadeId", "fonte", "fonteRef");

-- CreateIndex
CREATE UNIQUE INDEX "Mensagem_hash_key" ON "Mensagem"("hash");

-- CreateIndex
CREATE INDEX "Mensagem_contatoId_enviadaEm_idx" ON "Mensagem"("contatoId", "enviadaEm");

-- CreateIndex
CREATE INDEX "Mensagem_oportunidadeId_enviadaEm_idx" ON "Mensagem"("oportunidadeId", "enviadaEm");

-- AddForeignKey
ALTER TABLE "Combinado" ADD CONSTRAINT "Combinado_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaliseAgente" ADD CONSTRAINT "AnaliseAgente_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
