export const ROTULO_TIPO_TAREFA: Record<string, string> = { TAREFA: "Tarefa", LIGACAO: "Ligação", EMAIL: "E-mail", WHATSAPP: "WhatsApp", REUNIAO: "Reunião" };
export const ROTULO_PRIORIDADE: Record<string, string> = { BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta" };
export const ROTULO_RECORRENCIA: Record<string, string> = { DIARIA: "Todo dia", SEMANAL: "Toda semana", MENSAL: "Todo mês" };
export const ROTULO_TIPO_FEEDBACK: Record<string, string> = { NOTA: "Nota", LIGACAO: "Ligação", WHATSAPP: "WhatsApp", EMAIL: "E-mail", REUNIAO: "Reunião", SISTEMA: "Sistema" };

/** Valor de <input type="datetime-local"> (hora local do navegador) → ISO UTC. Vazio → null. */
export const localParaIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function prazoTexto(iso: string | null, agora = new Date()): { texto: string; atrasada: boolean } {
  if (!iso) return { texto: "Sem prazo", atrasada: false };
  const d = new Date(iso);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = Math.round((dia - hoje) / 86_400_000);
  const rotulo = diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : diff === -1 ? "Ontem" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return { texto: `${rotulo} ${hora}`, atrasada: d.getTime() < agora.getTime() };
}
