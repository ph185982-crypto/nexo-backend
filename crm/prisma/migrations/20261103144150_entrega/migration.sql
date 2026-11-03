-- CreateTable
CREATE TABLE "ModeloEntrega" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModeloEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloEntregaItem" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pilar" TEXT NOT NULL,
    "prazoDias" INTEGER,
    "cliente" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "checklist" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ModeloEntregaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entrega" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimPrevistoEm" TIMESTAMP(3),
    "renovacaoEm" TIMESTAMP(3),
    "valorMensal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "modeloId" TEXT,
    "diagnostico" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntregaCartao" (
    "id" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pilar" TEXT NOT NULL DEFAULT 'COMERCIAL',
    "coluna" TEXT NOT NULL DEFAULT 'BACKLOG',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "dataAlvo" TIMESTAMP(3),
    "cliente" BOOLEAN NOT NULL DEFAULT false,
    "responsavelId" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "colunaDesdeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntregaCartao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModeloEntrega_nome_key" ON "ModeloEntrega"("nome");

-- CreateIndex
CREATE INDEX "ModeloEntregaItem_modeloId_ordem_idx" ON "ModeloEntregaItem"("modeloId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "Entrega_oportunidadeId_key" ON "Entrega"("oportunidadeId");

-- CreateIndex
CREATE INDEX "Entrega_status_renovacaoEm_idx" ON "Entrega"("status", "renovacaoEm");

-- CreateIndex
CREATE INDEX "Entrega_contatoId_idx" ON "Entrega"("contatoId");

-- CreateIndex
CREATE INDEX "EntregaCartao_entregaId_coluna_ordem_idx" ON "EntregaCartao"("entregaId", "coluna", "ordem");

-- AddForeignKey
ALTER TABLE "ModeloEntregaItem" ADD CONSTRAINT "ModeloEntregaItem_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloEntrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrega" ADD CONSTRAINT "Entrega_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrega" ADD CONSTRAINT "Entrega_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrega" ADD CONSTRAINT "Entrega_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloEntrega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaCartao" ADD CONSTRAINT "EntregaCartao_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "Entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaCartao" ADD CONSTRAINT "EntregaCartao_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
