export interface SDRSession {
  mode: "SDR";
  nome: string;
  canais_atuais: string[];
  tem_loja_fisica: boolean;
  faturamento_total: string;
  ja_vende_marketplace: boolean;
  marketplace_atual: string[];
  problema_principal: string;
  cnpj: string;
  opera_com_equipe: boolean | null;
  disponibilidade: string;
  score: number;
  rota: "A" | "B" | "";
  produto_indicado: "Consultoria" | "Gestão" | "";
  objecoes_mencionadas: string[];
  status:
    | "novo"
    | "em_qualificacao"
    | "qualificado"
    | "morno"
    | "frio"
    | "fora"
    | "handoff_enviado"
    | "inativo";
  etapa: string;
  /** ISO da 1ª vez em que o lead bateu os 3 critérios (loja física + faturamento + CNPJ). */
  qualificado_em?: string;
  /** Nome do negócio/empresa do lead (não o nome da pessoa). */
  empresa?: string;
  /** O que a empresa vende / segmento (ex.: "moda feminina", "autopeças"). */
  segmento?: string;
  /** Resposta explícita sobre loja física: "sim" | "nao" | "" (não perguntado). */
  loja_fisica?: "sim" | "nao" | "";
  /** Início da ligação combinada com o lead (ISO, horário de Brasília convertido). */
  horario_reuniao?: string;
  /** ID do CalendarEvent criado quando a ligação foi marcada. */
  reuniao_evento_id?: string;
}

export interface SDRMessage {
  text: string;
  delay: number;
  /** true → esse balão é enviado como nota de voz (TTS) em vez de texto. */
  audio?: boolean;
}

export interface SDRLLMResponse {
  messages: SDRMessage[];
  updateSession?: Partial<SDRSession>;
  action: "continue" | "handoff" | "nurture" | "close";
}

export const SDR_EMPTY_SESSION: SDRSession = {
  mode: "SDR",
  nome: "",
  canais_atuais: [],
  tem_loja_fisica: false,
  faturamento_total: "",
  ja_vende_marketplace: false,
  marketplace_atual: [],
  problema_principal: "",
  cnpj: "",
  opera_com_equipe: null,
  disponibilidade: "",
  score: 0,
  rota: "",
  produto_indicado: "",
  objecoes_mencionadas: [],
  status: "novo",
  etapa: "boas_vindas",
};
