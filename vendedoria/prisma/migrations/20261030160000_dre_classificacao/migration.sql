-- Aba DRE do financeiro: classificação manual das categorias do extrato nas
-- linhas da DRE. Tabela nova, aditiva — nenhuma tabela existente é tocada.

-- CreateTable
CREATE TABLE "max_dre_classificacoes" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_dre_classificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "max_dre_classificacoes_tipo_categoria_key" ON "max_dre_classificacoes"("tipo", "categoria");
