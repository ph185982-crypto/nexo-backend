// Cliente HTTP da Central Avanteza para o Max (Inbox de combinados):
//   POST {CENTRAL_URL}/api/capturas                → registrar mensagem/áudio/legenda para um cliente
//   GET  {CENTRAL_URL}/api/capturas/pendencias     → ações abertas do cliente
//   POST {CENTRAL_URL}/api/capturas/concluir       → concluir ação por similaridade (ou por id)
//   POST {CENTRAL_URL}/api/capturas/importar       → conversa exportada do WhatsApp (.txt/.zip, até 4 MB)
// Authorization: Bearer {AVANTEZA_CAPTURE_KEY} (a MESMA da Central). Respostas validadas com zod; timeout em toda chamada;
// só a leitura (pendências) tem nova tentativa — escrita nunca é repetida (evitaria registrar/concluir em dobro).
// A chave nunca vai para log nem para mensagem de erro. Contrato: avanteza/docs/eventos.md (seção Capturas).
import { z } from "zod";

export const CENTRAL_URL_PADRAO = "https://app.avanteza.com.br";
export const LIMITE_IMPORTACAO = 4 * 1024 * 1024;

export type CodigoErroCentral = "nao-configurado" | "nao-autorizado" | "ambiguo" | "nao-encontrado" | "rejeitado" | "timeout" | "rede" | "http" | "formato";
export class CentralErro extends Error {
  constructor(message: string, public codigo: CodigoErroCentral, public status?: number, public opcoes?: { candidatos?: string[]; opcoes?: AcaoCentral[] }) {
    super(message);
    this.name = "CentralErro";
  }
}

const acaoSchema = z.object({
  id: z.string(), titulo: z.string(), prazo: z.string().nullable(), status: z.string(), responsavel: z.string(), atrasada: z.boolean(),
});
export type AcaoCentral = z.infer<typeof acaoSchema>;
const capturaSchema = z.object({
  capturaId: z.string(), duplicada: z.boolean(), status: z.string(), acoesCriadas: z.number(),
  acoes: z.array(z.object({ id: z.string(), titulo: z.string(), responsavel: z.string(), prazo: z.string() })),
});
export type CapturaCentral = z.infer<typeof capturaSchema>;
const pendenciasSchema = z.object({
  cliente: z.object({ id: z.string(), nome: z.string() }), total: z.number(), atrasadas: z.number(), doCliente: z.number(), acoes: z.array(acaoSchema),
});
export type PendenciasCentral = z.infer<typeof pendenciasSchema>;
const concluirSchema = z.object({ cliente: z.object({ id: z.string(), nome: z.string() }), concluida: z.object({ id: z.string(), titulo: z.string() }) });
const importarSchema = z.object({
  clientId: z.string(), titulo: z.string().nullable(), mensagens: z.number(), novas: z.number(), duplicadas: z.number(), blocos: z.number(),
  acoesCriadas: z.number(), audiosTranscritos: z.number(), audiosNaoTranscritos: z.number(), semIa: z.boolean(), erros: z.array(z.string()),
});
export type ImportacaoCentral = z.infer<typeof importarSchema>;
const erroSchema = z.object({ error: z.string().optional(), candidatos: z.array(z.string()).optional(), opcoes: z.array(acaoSchema).optional() }).passthrough();

export interface OpcoesCentral {
  baseUrl?: string;
  chave?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function opcoesDoAmbiente(env: Record<string, string | undefined> = process.env): OpcoesCentral {
  return { baseUrl: env.CENTRAL_URL?.trim() || CENTRAL_URL_PADRAO, chave: env.AVANTEZA_CAPTURE_KEY?.trim() || null };
}

export interface ClienteCentral {
  registrar(c: { cliente: string; texto?: string | null; transcricao?: string | null; autor?: string | null; data?: string | null }): Promise<CapturaCentral>;
  pendencias(cliente: string): Promise<PendenciasCentral>;
  concluir(c: { cliente: string; acao?: string; acaoId?: string }): Promise<z.infer<typeof concluirSchema>>;
  importar(c: { cliente?: string | null; arquivo: string; conteudo: Buffer }): Promise<ImportacaoCentral>;
}

export function criarClienteCentral(o: OpcoesCentral = opcoesDoAmbiente()): ClienteCentral {
  const base = (o.baseUrl || CENTRAL_URL_PADRAO).replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function chamar<T>(metodo: "GET" | "POST", caminho: string, schema: z.ZodType<T>, opts: { corpo?: unknown; bruto?: { dados: Buffer; tipo: string }; timeoutMs?: number } = {}): Promise<T> {
    if (!o.chave) throw new CentralErro("A chave da Central (AVANTEZA_CAPTURE_KEY) não está configurada no Vendedor IA.", "nao-configurado");
    const tentativas = metodo === "GET" ? 1 : 0;
    let ultimo = new CentralErro("Não consegui falar com a Central agora.", "rede");
    for (let i = 0; i <= tentativas; i++) {
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${o.chave}`, Accept: "application/json" };
        let body: BodyInit | undefined;
        if (opts.corpo !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.corpo); }
        if (opts.bruto) { headers["Content-Type"] = opts.bruto.tipo; body = new Uint8Array(opts.bruto.dados); }
        const res = await doFetch(`${base}${caminho}`, { method: metodo, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? o.timeoutMs ?? 15_000), cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (res.ok) {
          const v = schema.safeParse(json);
          if (!v.success) throw new CentralErro("A Central respondeu num formato inesperado (versões diferentes?).", "formato");
          return v.data;
        }
        const e = erroSchema.safeParse(json);
        const msg = e.success && e.data.error && e.data.error.length < 300 ? e.data.error : `A Central respondeu com erro ${res.status}.`;
        if (res.status === 503) throw new CentralErro("A Central ainda não tem a chave AVANTEZA_CAPTURE_KEY configurada.", "nao-configurado", 503);
        if (res.status === 401) throw new CentralErro("A Central recusou a chave (AVANTEZA_CAPTURE_KEY diferente nos dois projetos).", "nao-autorizado", 401);
        if (res.status === 409) throw new CentralErro(msg, "ambiguo", 409, { candidatos: e.success ? e.data.candidatos : undefined, opcoes: e.success ? e.data.opcoes : undefined });
        if (res.status === 404) throw new CentralErro(msg, "nao-encontrado", 404);
        if (res.status >= 400 && res.status < 500) throw new CentralErro(msg, "rejeitado", res.status);
        ultimo = new CentralErro(msg, "http", res.status);
        if (i < tentativas) { await sleep(500); continue; }
        throw ultimo;
      } catch (err) {
        if (err instanceof CentralErro) throw err;
        const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        ultimo = new CentralErro(timeout ? "A Central demorou demais para responder." : "Não consegui falar com a Central agora.", timeout ? "timeout" : "rede");
        if (i < tentativas) { await sleep(500); continue; }
        throw ultimo;
      }
    }
    throw ultimo;
  }

  return {
    registrar: (c) => chamar("POST", "/api/capturas", capturaSchema, {
      corpo: { clienteNome: c.cliente, origem: "whatsapp_max", autor: c.autor ?? "Max (WhatsApp)", texto: c.texto ?? null, transcricao: c.transcricao ?? null, data: c.data ?? null },
      timeoutMs: 60_000, // a Central já extrai as ações com a IA
    }),
    pendencias: (cliente) => chamar("GET", `/api/capturas/pendencias?cliente=${encodeURIComponent(cliente)}`, pendenciasSchema),
    concluir: (c) => chamar("POST", "/api/capturas/concluir", concluirSchema, { corpo: { cliente: c.cliente, ...(c.acaoId ? { acaoId: c.acaoId } : { acao: c.acao }) } }),
    importar: (c) => {
      if (c.conteudo.length > LIMITE_IMPORTACAO) return Promise.reject(new CentralErro("Arquivo acima de 4 MB: exporte a conversa “sem mídia” e me mande de novo.", "rejeitado", 413));
      const q = new URLSearchParams({ arquivo: c.arquivo.slice(0, 200), ...(c.cliente ? { cliente: c.cliente } : {}) });
      const zip = c.conteudo.length > 4 && c.conteudo.readUInt32LE(0) === 0x04034b50;
      return chamar("POST", `/api/capturas/importar?${q}`, importarSchema, { bruto: { dados: c.conteudo, tipo: zip ? "application/zip" : "text/plain" }, timeoutMs: 240_000 });
    },
  };
}
