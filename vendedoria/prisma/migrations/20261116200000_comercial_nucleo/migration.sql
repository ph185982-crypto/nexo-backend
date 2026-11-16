-- Comercial unificado (Etapa 3, F3/C2): tabelas com_* portadas do CRM, User.ativo e colunas novas
-- opcionais em CalendarEvent. Aditiva: só CREATE TABLE/INDEX, ADD COLUMN e chaves estrangeiras novas.

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "contatoId" TEXT,
ADD COLUMN     "oportunidadeId" TEXT,
ADD COLUMN     "origem" TEXT,
ADD COLUMN     "responsavelId" TEXT,
ADD COLUMN     "tipo" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "com_contato" (
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
    "leadId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_contato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_funil" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "com_funil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_etapa" (
    "id" TEXT NOT NULL,
    "funilId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ABERTA',
    "descricao" TEXT,
    "kanbanColumnType" TEXT,

    CONSTRAINT "com_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_oportunidade" (
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
    "leadId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "resumoIa" JSONB,
    "resumoIaEm" TIMESTAMP(3),

    CONSTRAINT "com_oportunidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_historico_etapa" (
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

    CONSTRAINT "com_historico_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_evento_integracao" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "detalhe" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_evento_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_feedback" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "contatoId" TEXT,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "intencao" TEXT,
    "importante" BOOLEAN NOT NULL DEFAULT false,
    "autor" TEXT,
    "autorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_tarefa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'TAREFA',
    "prioridade" TEXT NOT NULL DEFAULT 'NORMAL',
    "prazoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "concluidaEm" TIMESTAMP(3),
    "recorrencia" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "responsavelId" TEXT,
    "contatoId" TEXT,
    "oportunidadeId" TEXT,
    "paiId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_modelo_entrega" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "com_modelo_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_modelo_entrega_item" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pilar" TEXT NOT NULL,
    "prazoDias" INTEGER,
    "cliente" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "checklist" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "com_modelo_entrega_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_entrega" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimPrevistoEm" TIMESTAMP(3),
    "renovacaoEm" TIMESTAMP(3),
    "valorMensal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "modeloId" TEXT,
    "diagnostico" JSONB NOT NULL DEFAULT '{}',
    "concluidaEm" TIMESTAMP(3),
    "renovacaoOportunidadeId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_entrega_cartao" (
    "id" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pilar" TEXT NOT NULL DEFAULT 'COMERCIAL',
    "coluna" TEXT NOT NULL DEFAULT 'BACKLOG',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "dataAlvo" TIMESTAMP(3),
    "cliente" BOOLEAN NOT NULL DEFAULT false,
    "responsavelId" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "colunaDesdeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planejadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_entrega_cartao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_automacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "gatilho" TEXT NOT NULL,
    "criterios" JSONB NOT NULL DEFAULT '[]',
    "acoes" JSONB NOT NULL DEFAULT '[]',
    "criadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_automacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_automacao_execucao" (
    "id" TEXT NOT NULL,
    "automacaoId" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "referenciaId" TEXT,
    "gatilho" TEXT NOT NULL,
    "indice" INTEGER NOT NULL,
    "acaoTipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "executarEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executadaEm" TIMESTAMP(3),
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_automacao_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_meta" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'TODOS',
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'TOTAL',
    "valor" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_combinado" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ENTREGAVEL',
    "responsavel" TEXT NOT NULL DEFAULT 'NOS',
    "prazoEm" TIMESTAMP(3),
    "pilar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGERIDO',
    "acao" TEXT NOT NULL DEFAULT 'NOVO',
    "alvoCombinadoId" TEXT,
    "alvoCartaoId" TEXT,
    "evidencia" TEXT,
    "confianca" DOUBLE PRECISION,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "analiseId" TEXT,
    "cartaoId" TEXT,
    "tarefaId" TEXT,
    "compromissoId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "decididoPorId" TEXT,
    "entregueEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_combinado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_analise_agente" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "fonteRef" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "resumo" TEXT,
    "erro" TEXT,
    "sugestoes" INTEGER NOT NULL DEFAULT 0,
    "modelo" TEXT,
    "tokensEntrada" INTEGER,
    "tokensSaida" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "com_analise_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_mensagem" (
    "id" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "oportunidadeId" TEXT,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "autor" TEXT NOT NULL,
    "deMim" BOOLEAN NOT NULL,
    "texto" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3) NOT NULL,
    "origem" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "analisadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_conta_google" (
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

    CONSTRAINT "com_conta_google_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_reuniao_google" (
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

    CONSTRAINT "com_reuniao_google_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_produto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT,
    "descricao" TEXT,
    "valor" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recorrencia" TEXT NOT NULL DEFAULT 'UNICO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_oportunidade_produto" (
    "id" TEXT NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "produtoId" TEXT,
    "nome" TEXT NOT NULL,
    "quantidade" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "valorUnitario" DECIMAL(14,2) NOT NULL,
    "desconto" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "recorrencia" TEXT NOT NULL DEFAULT 'UNICO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_oportunidade_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_configuracao" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_configuracao_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "com_proposta" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "oportunidadeId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "titulo" TEXT NOT NULL,
    "introducao" TEXT NOT NULL,
    "condicoes" TEXT NOT NULL,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "valorUnico" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valorMensal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "validaAte" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3),
    "visualizadaEm" TIMESTAMP(3),
    "respondidaEm" TIMESTAMP(3),
    "respostaNome" TEXT,
    "respostaComentario" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_proposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "com_contato_leadId_key" ON "com_contato"("leadId");

-- CreateIndex
CREATE INDEX "com_contato_tipo_nome_idx" ON "com_contato"("tipo", "nome");

-- CreateIndex
CREATE INDEX "com_contato_telefone_idx" ON "com_contato"("telefone");

-- CreateIndex
CREATE INDEX "com_contato_cicloDeVida_idx" ON "com_contato"("cicloDeVida");

-- CreateIndex
CREATE UNIQUE INDEX "com_funil_nome_key" ON "com_funil"("nome");

-- CreateIndex
CREATE INDEX "com_etapa_funilId_ordem_idx" ON "com_etapa"("funilId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "com_etapa_funilId_nome_key" ON "com_etapa"("funilId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "com_oportunidade_numero_key" ON "com_oportunidade"("numero");

-- CreateIndex
CREATE INDEX "com_oportunidade_funilId_status_etapaId_idx" ON "com_oportunidade"("funilId", "status", "etapaId");

-- CreateIndex
CREATE INDEX "com_oportunidade_contatoId_idx" ON "com_oportunidade"("contatoId");

-- CreateIndex
CREATE INDEX "com_oportunidade_leadId_idx" ON "com_oportunidade"("leadId");

-- CreateIndex
CREATE INDEX "com_oportunidade_encerradaEm_idx" ON "com_oportunidade"("encerradaEm");

-- CreateIndex
CREATE INDEX "com_historico_etapa_oportunidadeId_entrouEm_idx" ON "com_historico_etapa"("oportunidadeId", "entrouEm");

-- CreateIndex
CREATE INDEX "com_historico_etapa_paraEtapaId_entrouEm_idx" ON "com_historico_etapa"("paraEtapaId", "entrouEm");

-- CreateIndex
CREATE INDEX "com_historico_etapa_paraTipo_entrouEm_idx" ON "com_historico_etapa"("paraTipo", "entrouEm");

-- CreateIndex
CREATE UNIQUE INDEX "com_evento_integracao_eventoId_key" ON "com_evento_integracao"("eventoId");

-- CreateIndex
CREATE INDEX "com_evento_integracao_tipo_recebidoEm_idx" ON "com_evento_integracao"("tipo", "recebidoEm");

-- CreateIndex
CREATE INDEX "com_feedback_oportunidadeId_criadoEm_idx" ON "com_feedback"("oportunidadeId", "criadoEm");

-- CreateIndex
CREATE INDEX "com_feedback_contatoId_criadoEm_idx" ON "com_feedback"("contatoId", "criadoEm");

-- CreateIndex
CREATE INDEX "com_feedback_intencao_criadoEm_idx" ON "com_feedback"("intencao", "criadoEm");

-- CreateIndex
CREATE INDEX "com_tarefa_status_prazoEm_idx" ON "com_tarefa"("status", "prazoEm");

-- CreateIndex
CREATE INDEX "com_tarefa_responsavelId_status_idx" ON "com_tarefa"("responsavelId", "status");

-- CreateIndex
CREATE INDEX "com_tarefa_oportunidadeId_status_idx" ON "com_tarefa"("oportunidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "com_modelo_entrega_nome_key" ON "com_modelo_entrega"("nome");

-- CreateIndex
CREATE INDEX "com_modelo_entrega_item_modeloId_ordem_idx" ON "com_modelo_entrega_item"("modeloId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "com_entrega_oportunidadeId_key" ON "com_entrega"("oportunidadeId");

-- CreateIndex
CREATE INDEX "com_entrega_status_renovacaoEm_idx" ON "com_entrega"("status", "renovacaoEm");

-- CreateIndex
CREATE INDEX "com_entrega_contatoId_idx" ON "com_entrega"("contatoId");

-- CreateIndex
CREATE INDEX "com_entrega_cartao_entregaId_coluna_ordem_idx" ON "com_entrega_cartao"("entregaId", "coluna", "ordem");

-- CreateIndex
CREATE INDEX "com_automacao_ativo_gatilho_idx" ON "com_automacao"("ativo", "gatilho");

-- CreateIndex
CREATE UNIQUE INDEX "com_automacao_execucao_chave_key" ON "com_automacao_execucao"("chave");

-- CreateIndex
CREATE INDEX "com_automacao_execucao_status_executarEm_idx" ON "com_automacao_execucao"("status", "executarEm");

-- CreateIndex
CREATE INDEX "com_automacao_execucao_automacaoId_criadoEm_idx" ON "com_automacao_execucao"("automacaoId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "com_meta_escopo_ano_mes_tipo_key" ON "com_meta"("escopo", "ano", "mes", "tipo");

-- CreateIndex
CREATE INDEX "com_combinado_oportunidadeId_status_idx" ON "com_combinado"("oportunidadeId", "status");

-- CreateIndex
CREATE INDEX "com_combinado_analiseId_idx" ON "com_combinado"("analiseId");

-- CreateIndex
CREATE INDEX "com_analise_agente_status_criadoEm_idx" ON "com_analise_agente"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "com_analise_agente_oportunidadeId_fonte_fonteRef_key" ON "com_analise_agente"("oportunidadeId", "fonte", "fonteRef");

-- CreateIndex
CREATE UNIQUE INDEX "com_mensagem_hash_key" ON "com_mensagem"("hash");

-- CreateIndex
CREATE INDEX "com_mensagem_contatoId_enviadaEm_idx" ON "com_mensagem"("contatoId", "enviadaEm");

-- CreateIndex
CREATE INDEX "com_mensagem_origem_analisadaEm_idx" ON "com_mensagem"("origem", "analisadaEm");

-- CreateIndex
CREATE INDEX "com_mensagem_oportunidadeId_enviadaEm_idx" ON "com_mensagem"("oportunidadeId", "enviadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "com_conta_google_usuarioId_key" ON "com_conta_google"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "com_reuniao_google_conferenceRecord_key" ON "com_reuniao_google"("conferenceRecord");

-- CreateIndex
CREATE INDEX "com_reuniao_google_contaId_status_idx" ON "com_reuniao_google"("contaId", "status");

-- CreateIndex
CREATE INDEX "com_reuniao_google_oportunidadeId_idx" ON "com_reuniao_google"("oportunidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "com_produto_nome_key" ON "com_produto"("nome");

-- CreateIndex
CREATE INDEX "com_oportunidade_produto_oportunidadeId_idx" ON "com_oportunidade_produto"("oportunidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "com_proposta_numero_key" ON "com_proposta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "com_proposta_token_key" ON "com_proposta"("token");

-- CreateIndex
CREATE INDEX "com_proposta_oportunidadeId_versao_idx" ON "com_proposta"("oportunidadeId", "versao");

-- CreateIndex
CREATE INDEX "CalendarEvent_oportunidadeId_status_idx" ON "CalendarEvent"("oportunidadeId", "status");

-- CreateIndex
CREATE INDEX "CalendarEvent_startTime_idx" ON "CalendarEvent"("startTime");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_contato" ADD CONSTRAINT "com_contato_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "com_contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_contato" ADD CONSTRAINT "com_contato_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_contato" ADD CONSTRAINT "com_contato_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_etapa" ADD CONSTRAINT "com_etapa_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "com_funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "com_contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "com_funil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "com_etapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "MotivoEncerramento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade" ADD CONSTRAINT "com_oportunidade_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_historico_etapa" ADD CONSTRAINT "com_historico_etapa_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_feedback" ADD CONSTRAINT "com_feedback_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_feedback" ADD CONSTRAINT "com_feedback_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_tarefa" ADD CONSTRAINT "com_tarefa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_tarefa" ADD CONSTRAINT "com_tarefa_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_tarefa" ADD CONSTRAINT "com_tarefa_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_tarefa" ADD CONSTRAINT "com_tarefa_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "com_tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_modelo_entrega_item" ADD CONSTRAINT "com_modelo_entrega_item_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "com_modelo_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_entrega" ADD CONSTRAINT "com_entrega_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_entrega" ADD CONSTRAINT "com_entrega_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_entrega" ADD CONSTRAINT "com_entrega_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "com_modelo_entrega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_entrega_cartao" ADD CONSTRAINT "com_entrega_cartao_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "com_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_entrega_cartao" ADD CONSTRAINT "com_entrega_cartao_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_automacao_execucao" ADD CONSTRAINT "com_automacao_execucao_automacaoId_fkey" FOREIGN KEY ("automacaoId") REFERENCES "com_automacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_combinado" ADD CONSTRAINT "com_combinado_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_analise_agente" ADD CONSTRAINT "com_analise_agente_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_mensagem" ADD CONSTRAINT "com_mensagem_contatoId_fkey" FOREIGN KEY ("contatoId") REFERENCES "com_contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_conta_google" ADD CONSTRAINT "com_conta_google_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_reuniao_google" ADD CONSTRAINT "com_reuniao_google_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "com_conta_google"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade_produto" ADD CONSTRAINT "com_oportunidade_produto_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_oportunidade_produto" ADD CONSTRAINT "com_oportunidade_produto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "com_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_proposta" ADD CONSTRAINT "com_proposta_oportunidadeId_fkey" FOREIGN KEY ("oportunidadeId") REFERENCES "com_oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

