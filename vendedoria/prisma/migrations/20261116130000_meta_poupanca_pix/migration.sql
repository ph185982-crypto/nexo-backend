-- Chave Pix da meta de poupança (aditivo).
ALTER TABLE "max_metas_financeiras" ADD COLUMN IF NOT EXISTS "chave_pix" TEXT;
