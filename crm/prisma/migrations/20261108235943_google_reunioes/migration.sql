-- CreateTable
CREATE TABLE "ContaGoogle" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshTokenCifrado" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessExpiraEm" TIMESTAMP(3),
    "escopos" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "ultimaSincronizacaoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaGoogle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReuniaoGoogle" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "conferenceRecord" TEXT NOT NULL,
    "titulo" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "meetingCode" TEXT,
    "emails" TEXT[],
    "participantes" JSONB NOT NULL DEFAULT '[]',
    "transcricao" TEXT,
    "status" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "analiseId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReuniaoGoogle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContaGoogle_usuarioId_key" ON "ContaGoogle"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "ReuniaoGoogle_conferenceRecord_key" ON "ReuniaoGoogle"("conferenceRecord");

-- CreateIndex
CREATE INDEX "ReuniaoGoogle_contaId_status_idx" ON "ReuniaoGoogle"("contaId", "status");

-- CreateIndex
CREATE INDEX "ReuniaoGoogle_oportunidadeId_idx" ON "ReuniaoGoogle"("oportunidadeId");

-- AddForeignKey
ALTER TABLE "ContaGoogle" ADD CONSTRAINT "ContaGoogle_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReuniaoGoogle" ADD CONSTRAINT "ReuniaoGoogle_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "ContaGoogle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
