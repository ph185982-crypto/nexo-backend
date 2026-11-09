-- Espelho das conversas no CRM Avanteza
ALTER TABLE "WhatsappConversation" ADD COLUMN "crmSincronizadoAte" TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN "crmStatus" TEXT;
CREATE INDEX "WhatsappConversation_lastMessageAt_idx" ON "WhatsappConversation"("lastMessageAt");
