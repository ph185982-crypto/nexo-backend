-- Meta de poupança com cobrança diária (aditivo: nada é alterado ou apagado).
ALTER TABLE "max_metas_financeiras" ADD COLUMN IF NOT EXISTS "aporte_diario" DOUBLE PRECISION;
ALTER TABLE "max_metas_financeiras" ADD COLUMN IF NOT EXISTS "cobrar_diariamente" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "max_aportes_meta" (
    "id" TEXT NOT NULL,
    "meta_id" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data" DATE NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'max',
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "max_aportes_meta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "max_aportes_meta_meta_id_data_idx" ON "max_aportes_meta"("meta_id", "data");
