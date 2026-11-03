-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'ADMIN',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contato" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "documento" TEXT,
    "segmento" TEXT,
    "cargo" TEXT,
    "cicloDeVida" TEXT NOT NULL DEFAULT 'LEAD',
    "origem" TEXT,
    "empresaId" TEXT,
    "responsavelId" TEXT,
    "vendedorIaLeadId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funil" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Funil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Etapa" (
    "id" TEXT NOT NULL,
    "funilId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ABERTA',
    "descricao" TEXT,

    CONSTRAINT "Etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oportunidade" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "pessoaId" TEXT,
    "funilId" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "responsavelId" TEXT,
    "valorUnico" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valorMensal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "probabilidade" TEXT,
    "origem" TEXT,
    "tags" TEXT[],
    "finalizaEm" TIMESTAMP(3),
    "etapaDesdeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMP(3),
    "motivoId" TEXT,
    "motivoDetalhe" TEXT,
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendedorIaLeadId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oportunidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoEtapa" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "deEtapaId" TEXT,
    "deFunilNome" TEXT,
    "deEtapaNome" TEXT,
    "paraEtapaId" TEXT NOT NULL,
    "paraFunilNome" TEXT NOT NULL,
    "paraEtapaNome" TEXT NOT NULL,
    "paraTipo" TEXT NOT NULL,
    "entrouEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saiuEm" TIMESTAMP(3),
    "origem" TEXT NOT NULL,
    "ator" TEXT,
    "motivo" TEXT,

    CONSTRAINT "HistoricoEtapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivoEncerramento" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MotivoEncerramento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChaveIntegracao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),

    CONSTRAINT "ChaveIntegracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoIntegracao" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "detalhe" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoIntegracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TentativaLogin" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Contato_vendedorIaLeadId_key" ON "Contato"("vendedorIaLeadId");

-- CreateIndex
CREATE INDEX "Contato_tipo_nome_idx" ON "Contato"("tipo", "nome");

-- CreateIndex
CREATE INDEX "Contato_telefone_idx" ON "Contato"("telefone");

-- CreateIndex
CREATE INDEX "Contato_cicloDeVida_idx" ON "Contato"("cicloDeVida");

-- CreateIndex
CREATE UNIQUE INDEX "Funil_nome_key" ON "Funil"("nome");

-- CreateIndex
CREATE INDEX "Etapa_funilId_ordem_idx" ON "Etapa"("funilId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "Etapa_funilId_nome_key" ON "Etapa"("funilId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Oportunidade_numero_key" ON "Oportunidade"("numero");

-- CreateIndex
CREATE INDEX "Oportunidade_funilId_status_etapaId_idx" ON "Oportunidade"("funilId", "status", "etapaId");

-- CreateIndex
CREATE INDEX "Oportunidade_contatoId_idx" ON "Oportunidade"("contatoId");

-- CreateIndex
CREATE INDEX "Oportunidade_vendedorIaLeadId_idx" ON "Oportunidade"("vendedorIaLeadId");

-- CreateIndex
CREATE INDEX "Oportunidade_encerradaEm_idx" ON "Oportunidade"("encerradaEm");

-- CreateIndex
CREATE INDEX "HistoricoEtapa_oportunidadeId_entrouEm_idx" ON "HistoricoEtapa"("oportunidadeId", "entrouEm");

-- CreateIndex
CREATE INDEX "HistoricoEtapa_paraEtapaId_entrouEm_idx" ON "HistoricoEtapa"("paraEtapaId", "entrouEm");

-- CreateIndex
CREATE INDEX "HistoricoEtapa_paraTipo_entrouEm_idx" ON "HistoricoEtapa"("paraTipo", "entrouEm");

-- CreateIndex
CREATE UNIQUE INDEX "MotivoEncerramento_tipo_nome_key" ON "MotivoEncerramento"("tipo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "ChaveIntegracao_hash_key" ON "ChaveIntegracao"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "EventoIntegracao_eventoId_key" ON "EventoIntegracao"("eventoId");

-- CreateIndex
CREATE INDEX "EventoIntegracao_tipo_recebidoEm_idx" ON "EventoIntegracao"("tipo", "recebidoEm");

-- CreateIndex
CREATE INDEX "TentativaLogin_chave_criadaEm_idx" ON "TentativaLogin"("chave", "criadaEm");

-- AddForeignKey
ALTER TABLE "Contato" ADD CONSTRAINT "Contato_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contato" ADD CONSTRAINT "Contato_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Etapa" ADD CONSTRAINT "Etapa_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "Funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "Contato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "Funil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "Etapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidade" ADD CONSTRAINT "Oportunidade_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "MotivoEncerramento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoEtapa" ADD CONSTRAINT "HistoricoEtapa_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "Oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
