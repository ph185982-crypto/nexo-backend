-- Roteiro da Júlia (SDR Avanteza, 24/11/2026): padrões do AgentConfig e Kanban novo.
-- Idempotente: pode rodar num banco já ajustado sem efeito.

-- Padrões do agente (os valores atuais são sincronizados pelo código: src/lib/ai/sdr/julia/identidade.ts)
ALTER TABLE "AgentConfig" ALTER COLUMN "agentName" SET DEFAULT 'Júlia';
ALTER TABLE "AgentConfig" ALTER COLUMN "followUpHours" SET DEFAULT '24,72';
ALTER TABLE "AgentConfig" ALTER COLUMN "maxFollowUps" SET DEFAULT 2;
UPDATE "AgentConfig" SET "agentName" = 'Júlia', "followUpHours" = '24,72', "maxFollowUps" = 2;
UPDATE "Agent" SET "displayName" = 'SDR Avanteza' WHERE "systemPrompt" LIKE '[SDR]%';

-- "Handoff enviado" vira "Ligação marcada" (continua ESCALATED: só entra quem é QUALIFICADO e escolheu horário)
UPDATE "KanbanColumn" SET "name" = 'Ligação marcada' WHERE "name" = 'Handoff enviado' AND "type" = 'ESCALATED';

-- "Fora do ICP" ganha tipo próprio (JUNK, também é perda) para "Perdido" ficar com o LOST
UPDATE "KanbanColumn" SET "type" = 'JUNK' WHERE "name" = 'Fora do ICP' AND "type" = 'LOST';

-- Coluna nova "Perdido" (LOST, motivo obrigatório) nas organizações do funil da SDR
INSERT INTO "KanbanColumn" ("id", "name", "order", "type", "isSystemDefault", "isDefaultEntry", "organizationId", "color", "createdAt")
SELECT 'perdido_' || substr(md5(k."organizationId"), 1, 20), 'Perdido', 13, 'LOST', true, false, k."organizationId", '#64748B', NOW()
  FROM "KanbanColumn" k
 WHERE k."name" = 'Fora do ICP'
   AND NOT EXISTS (SELECT 1 FROM "KanbanColumn" x WHERE x."organizationId" = k."organizationId" AND x."type" = 'LOST');

-- Ordem final das colunas
UPDATE "KanbanColumn" c SET "order" = v.ord
  FROM (VALUES ('Novos', 0), ('Em qualificação', 1), ('Qualificados', 2), ('Ligação marcada', 3), ('1º Contato', 4),
               ('2º Contato', 5), ('3º Contato', 6), ('Reunião Agendada', 7), ('Proposta', 8), ('Em Contrato', 9),
               ('Ganho', 10), ('Mornos', 11), ('Mornos (nutrição)', 11), ('Fora do ICP', 12), ('Perdido', 13)) AS v(nome, ord)
 WHERE c."name" = v.nome
   AND c."organizationId" IN (SELECT "organizationId" FROM "KanbanColumn" WHERE "name" = 'Ligação marcada');
