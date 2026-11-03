-- CreateTable
CREATE TABLE "Meta" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'TODOS',
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'TOTAL',
    "valor" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meta_escopo_ano_mes_tipo_key" ON "Meta"("escopo", "ano", "mes", "tipo");
