// Tratador em processo dos eventos do Vendedor IA (F5/C10). É o mesmo código que o CRM antigo roda ao receber
// POST /api/integracoes/vendedor-ia/eventos (portado em ./vendedor-ia.ts): com COMERCIAL_NATIVO=1, a outbox
// (lib/crm-externo/outbox.ts) chama estas funções em vez de fazer o POST. Idempotente por eventoId (ComEventoIntegracao).
export { validarEvento, processarEventoVendedorIa, normalizarTelefone, type EventoVendedorIa, type ResultadoEvento } from "./vendedor-ia";
