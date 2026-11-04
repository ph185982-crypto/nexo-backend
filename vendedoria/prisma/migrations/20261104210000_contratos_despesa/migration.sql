-- Contratos de despesa (financiamento, parcela do carro, empréstimo, internet, água, luz).
-- Aditivo: tabela nova e colunas novas e opcionais em max_contas_pagar; nenhuma linha
-- existente é alterada.

-- AlterTable
ALTER TABLE "max_contas_pagar" ADD COLUMN     "contrato_id" TEXT,
ADD COLUMN     "estimada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parcela_numero" INTEGER,
ADD COLUMN     "parcelas_total" INTEGER;

-- CreateTable
CREATE TABLE "max_contratos_despesa" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "credor" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'Outros',
    "tipo_negocio" TEXT NOT NULL DEFAULT 'pessoal',
    "valor_parcela" DOUBLE PRECISION NOT NULL,
    "parcelas_total" INTEGER,
    "dia_vencimento" INTEGER NOT NULL,
    "data_inicio" DATE NOT NULL,
    "entrada" DOUBLE PRECISION,
    "entrada_data" DATE,
    "saldo_devedor" DOUBLE PRECISION,
    "estimada" BOOLEAN NOT NULL DEFAULT false,
    "cronograma" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_contratos_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "max_contas_pagar_contrato_id_idx" ON "max_contas_pagar"("contrato_id");

-- CreateIndex
CREATE UNIQUE INDEX "max_contas_pagar_contrato_id_parcela_numero_key" ON "max_contas_pagar"("contrato_id", "parcela_numero");
