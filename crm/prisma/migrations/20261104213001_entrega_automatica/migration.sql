-- AlterTable
ALTER TABLE "AutomacaoExecucao" ADD COLUMN     "referenciaId" TEXT;

-- AlterTable
ALTER TABLE "Entrega" ADD COLUMN     "concluidaEm" TIMESTAMP(3),
ADD COLUMN     "renovacaoOportunidadeId" TEXT;

-- AlterTable
ALTER TABLE "EntregaCartao" ADD COLUMN     "planejadoEm" TIMESTAMP(3);
