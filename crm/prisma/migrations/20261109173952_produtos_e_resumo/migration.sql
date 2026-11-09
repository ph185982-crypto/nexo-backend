-- AlterTable
ALTER TABLE "Oportunidade" ADD COLUMN     "resumoIa" JSONB,
ADD COLUMN     "resumoIaEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT,
    "descricao" TEXT,
    "valor" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recorrencia" TEXT NOT NULL DEFAULT 'UNICO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OportunidadeProduto" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "produtoId" TEXT,
    "nome" TEXT NOT NULL,
    "quantidade" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "valorUnitario" DECIMAL(14,2) NOT NULL,
    "desconto" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "recorrencia" TEXT NOT NULL DEFAULT 'UNICO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OportunidadeProduto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Produto_nome_key" ON "Produto"("nome");

-- CreateIndex
CREATE INDEX "OportunidadeProduto_oportunidadeId_idx" ON "OportunidadeProduto"("oportunidadeId");

-- AddForeignKey
ALTER TABLE "OportunidadeProduto" ADD CONSTRAINT "OportunidadeProduto_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OportunidadeProduto" ADD CONSTRAINT "OportunidadeProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
