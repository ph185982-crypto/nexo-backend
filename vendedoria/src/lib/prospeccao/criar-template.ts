import { prisma } from "@/lib/prisma/client";
import { resolverWaba } from "./meta-waba";

const GRAPH = "https://graph.facebook.com/v20.0";

// Exemplo automático por variável — a Meta exige um valor de exemplo plausível
// pra cada {{n}} na hora de submeter o template pra aprovação. O usuário só
// escolhe QUAL variável semântica cada {{n}} representa (mesma lista usada no
// disparo pra substituir de verdade na hora do envio); o texto de exemplo é
// só pra revisão da Meta, nunca é enviado a um lead de verdade.
const EXEMPLO_POR_VARIAVEL: Record<string, string> = {
  nomeNegocio: "Loja Exemplo",
  sinalOportunidade: "sem site próprio",
  tipoNegocio: "moda feminina",
  telefone: "(62) 99999-9999",
  website: "instagram.com/suaempresa",
};

export const CATEGORIAS_META = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type CategoriaMeta = (typeof CATEGORIAS_META)[number];

export function slugificarNomeTemplate(bruto: string): string {
  return bruto
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

export interface CriarTemplateInput {
  organizationId: string;
  nome: string;
  categoria: CategoriaMeta;
  idioma?: string;
  corpoTexto: string;
  variaveisOrdem: string[]; // uma chave semântica por {{n}}, na ordem 1..n
  rodape?: string;
}

export type ResultadoCriarTemplate =
  | { ok: true; templateId: string; metaId: string; status: string; nome: string }
  | { ok: false; error: string; status: number; detalhe?: unknown };

export async function criarTemplateNaMeta(input: CriarTemplateInput): Promise<ResultadoCriarTemplate> {
  const nome = slugificarNomeTemplate(input.nome);
  if (!nome) {
    return { ok: false, error: "nome do template inválido após normalização", status: 400 };
  }
  if (!input.corpoTexto?.trim()) {
    return { ok: false, error: "corpo da mensagem é obrigatório", status: 400 };
  }
  if (input.corpoTexto.length > 1024) {
    return { ok: false, error: "corpo da mensagem excede 1024 caracteres (limite da Meta)", status: 400 };
  }

  const placeholders = input.corpoTexto.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  const numerosUsados = placeholders.map((p) => Number(p.replace(/\D/g, "")));
  const numerosEsperados = input.variaveisOrdem.map((_, i) => i + 1);
  const sequencialOk = numerosUsados.length === numerosEsperados.length
    && numerosUsados.every((n, i) => n === numerosEsperados[i]);
  if (!sequencialOk) {
    return {
      ok: false,
      status: 400,
      error: `o corpo tem ${numerosUsados.length} placeholder(s) (${placeholders.join(", ") || "nenhum"}) mas ${input.variaveisOrdem.length} variável(is) foi(ram) selecionada(s) — precisa bater e ser sequencial ({{1}}, {{2}}, ...)`,
    };
  }

  const resolucao = await resolverWaba(input.organizationId);
  if (!resolucao.ok) {
    return { ok: false, error: resolucao.error, status: resolucao.status, detalhe: resolucao.debug };
  }
  const { wabaId, token } = resolucao.waba;

  const exemplos = input.variaveisOrdem.map((v) => EXEMPLO_POR_VARIAVEL[v] ?? "exemplo");

  const components: Array<Record<string, unknown>> = [
    {
      type: "BODY",
      text: input.corpoTexto,
      ...(exemplos.length > 0 ? { example: { body_text: [exemplos] } } : {}),
    },
  ];
  if (input.rodape?.trim()) {
    components.push({ type: "FOOTER", text: input.rodape.trim() });
  }

  const idioma = input.idioma ?? "pt_BR";

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: nome, language: idioma, category: input.categoria, components }),
    });
  } catch (e) {
    return { ok: false, error: "falha de rede ao chamar a Meta", status: 502, detalhe: String(e) };
  }

  const data = await res.json().catch(() => ({})) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } };

  if (!res.ok || !data.id) {
    return {
      ok: false,
      status: res.status || 502,
      error: data.error?.error_user_msg ?? data.error?.message ?? "Meta recusou o template",
      detalhe: data,
    };
  }

  const status = data.status ?? "PENDING";

  const template = await prisma.templateProspeccao.create({
    data: {
      organizationId: input.organizationId,
      nomeTemplateMeta: nome,
      idioma,
      variaveis: input.variaveisOrdem,
      corpoTexto: input.corpoTexto,
      ativo: false, // só ativa depois de aprovado — ver /disparo/template-meta pra checar status
    },
  });

  return { ok: true, templateId: template.id, metaId: data.id, status, nome };
}
