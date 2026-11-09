// Propostas: criadas a partir dos produtos da oportunidade, com versões. Enviada, ganha um link público (/p/{token})
// em que o cliente lê, baixa em PDF (impressão do navegador) e aceita ou recusa. Tudo fica na linha do tempo.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ErroEntrada, texto, textoOpc } from "@/lib/validar";
import { lerPrazo } from "@/lib/combinados/modelo";
import { linhasDaOportunidade } from "@/lib/oportunidades/produtos";

export const STATUS_PROPOSTA = ["RASCUNHO", "ENVIADA", "ACEITA", "RECUSADA", "OBSOLETA"] as const;
export const ROTULO_STATUS_PROPOSTA: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADA: "Enviada", ACEITA: "Aceita", RECUSADA: "Recusada", OBSOLETA: "Substituída" };

export const TEXTO_PADRAO = {
  introducao: "Olá, {contato}!\n\nConforme conversamos, segue a proposta da Avanteza para {cliente}. O trabalho é feito junto com a sua equipe, com plano de ação por pilar e acompanhamento até o resultado aparecer no caixa.",
  condicoes: "Valor único: pago conforme combinado na assinatura.\nMensalidade: vence uma vez por mês, a partir do início do trabalho.\nInício em até 7 dias após o aceite.",
};
const CHAVE = { introducao: "proposta.introducao", condicoes: "proposta.condicoes" } as const;
const VALIDADE_DIAS = 15;

export interface ItemProposta { nome: string; quantidade: number; valorUnitario: number; desconto: number; recorrencia: string; total: number }

export const codigoProposta = (p: { numero: number; criadoEm: Date; versao: number }) =>
  `${String(p.numero).padStart(5, "0")}/${p.criadoEm.getUTCFullYear()}${p.versao > 1 ? ` v${p.versao}` : ""}`;

export async function textosPadrao() {
  const linhas = await prisma.configuracao.findMany({ where: { chave: { in: Object.values(CHAVE) } } });
  const ler = (k: keyof typeof CHAVE) => linhas.find((l) => l.chave === CHAVE[k])?.valor ?? TEXTO_PADRAO[k];
  return { introducao: ler("introducao"), condicoes: ler("condicoes") };
}

export async function salvarTextosPadrao(c: Record<string, unknown>) {
  const t = { introducao: texto(c.introducao, "Introdução", { min: 10, max: 5000 }), condicoes: texto(c.condicoes, "Condições", { min: 10, max: 5000 }) };
  await prisma.$transaction((["introducao", "condicoes"] as const).map((k) => prisma.configuracao.upsert({ where: { chave: CHAVE[k] }, update: { valor: t[k] }, create: { chave: CHAVE[k], valor: t[k] } })));
  return t;
}

/** {cliente}, {contato}, {oportunidade}, {consultor} viram os dados da oportunidade. */
export function preencher(modelo: string, v: { cliente: string; contato: string; oportunidade: string; consultor: string }) {
  return modelo.replace(/\{(cliente|contato|oportunidade|consultor)\}/g, (_, k: keyof typeof v) => v[k]);
}

const num = (d: { toString(): string }) => Number(d.toString());

/** Nova proposta (ou nova versão): copia os produtos de agora. As anteriores ainda abertas viram "Substituída". */
export async function criarProposta(oportunidadeId: string, autor: { id: string; nome: string | null }, agora = new Date()) {
  const op = await prisma.oportunidade.findUnique({ where: { id: oportunidadeId }, include: { contato: { select: { nome: true } }, pessoa: { select: { nome: true } } } });
  if (!op) return null;
  let itens: ItemProposta[] = (await linhasDaOportunidade(oportunidadeId)).map((l) => ({ nome: l.nome, quantidade: l.quantidade, valorUnitario: l.valorUnitario, desconto: l.desconto, recorrencia: l.recorrencia, total: l.total }));
  if (!itens.length) {
    // Sem produtos: usa os valores digitados na oportunidade.
    const unico = num(op.valorUnico), mensal = num(op.valorMensal);
    itens = [
      ...(unico > 0 ? [{ nome: "Projeto", quantidade: 1, valorUnitario: unico, desconto: 0, recorrencia: "UNICO", total: unico }] : []),
      ...(mensal > 0 ? [{ nome: "Acompanhamento mensal", quantidade: 1, valorUnitario: mensal, desconto: 0, recorrencia: "MENSAL", total: mensal }] : []),
    ];
  }
  if (!itens.length) throw new ErroEntrada("Adicione produtos (ou um valor) à oportunidade antes de criar a proposta");
  const valorUnico = itens.filter((i) => i.recorrencia !== "MENSAL").reduce((s, i) => s + i.total, 0);
  const valorMensal = itens.filter((i) => i.recorrencia === "MENSAL").reduce((s, i) => s + i.total, 0);
  const padrao = await textosPadrao();
  const v = { cliente: op.contato.nome, contato: (op.pessoa?.nome ?? op.contato.nome).split(" ")[0], oportunidade: op.nome, consultor: autor.nome ?? "Avanteza" };
  const fim = new Date(agora.getTime() + VALIDADE_DIAS * 86_400_000);

  return prisma.$transaction(async (tx) => {
    const ultima = await tx.proposta.findFirst({ where: { oportunidadeId }, orderBy: { versao: "desc" }, select: { versao: true, titulo: true, introducao: true, condicoes: true } });
    await tx.proposta.updateMany({ where: { oportunidadeId, status: { in: ["RASCUNHO", "ENVIADA"] } }, data: { status: "OBSOLETA" } });
    return tx.proposta.create({
      data: {
        oportunidadeId, versao: (ultima?.versao ?? 0) + 1, criadoPorId: autor.id,
        // Versão nova mantém os textos que a pessoa já ajustou na anterior.
        titulo: ultima?.titulo ?? `Proposta Avanteza — ${op.contato.nome}`,
        introducao: ultima?.introducao ?? preencher(padrao.introducao, v),
        condicoes: ultima?.condicoes ?? preencher(padrao.condicoes, v),
        itens: itens as object[], valorUnico, valorMensal,
        validaAte: new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate(), 21)), // 18h de Brasília
        token: randomBytes(24).toString("base64url"),
      },
    });
  });
}

export function validarEdicaoProposta(c: Record<string, unknown>) {
  const o: { titulo?: string; introducao?: string; condicoes?: string; validaAte?: Date | null } = {};
  if (c.titulo !== undefined) o.titulo = texto(c.titulo, "Título", { min: 3, max: 160 });
  if (c.introducao !== undefined) o.introducao = textoOpc(c.introducao, "Introdução", 5000) ?? "";
  if (c.condicoes !== undefined) o.condicoes = textoOpc(c.condicoes, "Condições", 5000) ?? "";
  if (c.validaAte !== undefined) o.validaAte = lerPrazo(c.validaAte);
  return o;
}

/** Só rascunho se edita: o que o cliente já recebeu não muda (faça uma versão nova). */
export async function editarProposta(id: string, d: ReturnType<typeof validarEdicaoProposta>) {
  const r = await prisma.proposta.updateMany({ where: { id, status: "RASCUNHO" }, data: d });
  if (r.count) return true;
  if (await prisma.proposta.findUnique({ where: { id }, select: { id: true } })) throw new ErroEntrada("Só o rascunho pode ser editado: crie uma versão nova");
  return false;
}

async function registrar(oportunidadeId: string, textoFeedback: string, extra: { intencao?: string; importante?: boolean; autor?: string | null; autorNome?: string | null } = {}) {
  await prisma.feedback.create({ data: { oportunidadeId, tipo: "SISTEMA", texto: textoFeedback, autor: extra.autor ?? null, autorNome: extra.autorNome ?? null, intencao: extra.intencao ?? null, importante: extra.importante ?? false } });
  await prisma.oportunidade.update({ where: { id: oportunidadeId }, data: { ultimaAtividadeEm: new Date() } });
}

export async function enviarProposta(id: string, autor: { id: string; nome: string | null }) {
  const p = await prisma.proposta.findUnique({ where: { id } });
  if (!p) return null;
  if (p.status !== "RASCUNHO") throw new ErroEntrada("Esta proposta já foi enviada");
  const r = await prisma.proposta.updateMany({ where: { id, status: "RASCUNHO" }, data: { status: "ENVIADA", enviadaEm: new Date() } });
  if (!r.count) throw new ErroEntrada("Esta proposta já foi enviada");
  await registrar(p.oportunidadeId, `Enviou a proposta ${codigoProposta(p)}`, { autor: autor.id, autorNome: autor.nome });
  return prisma.proposta.findUnique({ where: { id } });
}

/** Página pública: a proposta e quem a fez. Primeira abertura pelo cliente fica registrada. */
export async function propostaPublica(token: string, o: { registrarVisita?: boolean } = {}) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const p = await prisma.proposta.findUnique({
    where: { token },
    include: { oportunidade: { select: { id: true, nome: true, contato: { select: { nome: true } }, pessoa: { select: { nome: true } }, responsavel: { select: { nome: true, email: true } } } } },
  });
  if (!p || p.status === "RASCUNHO") return null; // rascunho não tem link
  if (o.registrarVisita && p.status === "ENVIADA" && !p.visualizadaEm) {
    const r = await prisma.proposta.updateMany({ where: { id: p.id, visualizadaEm: null }, data: { visualizadaEm: new Date() } });
    if (r.count) await registrar(p.oportunidadeId, `O cliente abriu a proposta ${codigoProposta(p)}`);
  }
  return p;
}

export const vencida = (p: { validaAte: Date | null }, agora = new Date()) => !!p.validaAte && p.validaAte < agora;

type Resposta = { ok: true; resultado: "ACEITA" | "RECUSADA" } | { ok: false; erro: string; status: 404 | 409 };

export async function responderProposta(token: string, r: { aceitar: boolean; nome: string; comentario: string | null }, agora = new Date()): Promise<Resposta> {
  const p = await propostaPublica(token);
  if (!p) return { ok: false, erro: "Proposta não encontrada", status: 404 };
  if (p.status !== "ENVIADA") return { ok: false, erro: p.status === "OBSOLETA" ? "Esta versão foi substituída por uma mais nova. Peça o link atualizado." : "Esta proposta já foi respondida.", status: 409 };
  if (vencida(p, agora)) return { ok: false, erro: "A validade desta proposta terminou. Fale com o consultor para renová-la.", status: 409 };
  const status = r.aceitar ? "ACEITA" : "RECUSADA";
  const ok = await prisma.proposta.updateMany({ where: { id: p.id, status: "ENVIADA" }, data: { status, respondidaEm: agora, respostaNome: r.nome, respostaComentario: r.comentario } });
  if (!ok.count) return { ok: false, erro: "Esta proposta já foi respondida.", status: 409 };
  const comentario = r.comentario ? `\n"${r.comentario}"` : "";
  await registrar(p.oportunidadeId, `${r.nome} ${r.aceitar ? "ACEITOU" : "recusou"} a proposta ${codigoProposta(p)} pelo link.${comentario}`, { intencao: r.aceitar ? "SINAL_FECHAMENTO" : undefined, importante: true, autorNome: r.nome });
  if (r.aceitar) await prisma.oportunidade.update({ where: { id: p.oportunidadeId }, data: { probabilidade: "QUENTE" } });
  return { ok: true, resultado: status };
}

export async function propostasDaOportunidade(oportunidadeId: string) {
  const ps = await prisma.proposta.findMany({ where: { oportunidadeId }, orderBy: { versao: "desc" } });
  return ps.map((p) => ({
    id: p.id, codigo: codigoProposta(p), versao: p.versao, status: p.status, titulo: p.titulo, introducao: p.introducao, condicoes: p.condicoes,
    itens: p.itens as unknown as ItemProposta[], valorUnico: num(p.valorUnico), valorMensal: num(p.valorMensal), validaAte: p.validaAte, token: p.token,
    enviadaEm: p.enviadaEm, visualizadaEm: p.visualizadaEm, respondidaEm: p.respondidaEm, respostaNome: p.respostaNome, respostaComentario: p.respostaComentario, criadoEm: p.criadoEm,
  }));
}
