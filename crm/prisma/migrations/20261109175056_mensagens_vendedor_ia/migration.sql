-- AlterTable
ALTER TABLE "Mensagem" ADD COLUMN     "analisadaEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Mensagem_origem_analisadaEm_idx" ON "Mensagem"("origem", "analisadaEm");

-- O que já existia foi lido na importação.
UPDATE "Mensagem" SET "analisadaEm" = "criadoEm";
