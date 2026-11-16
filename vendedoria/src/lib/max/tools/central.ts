// Ferramentas do Max ligadas à Central Avanteza (Inbox de combinados dos CLIENTES da consultoria — nada do financeiro):
//   registrar_para_cliente  "para a Showman: …", mensagem encaminhada, áudio transcrito, legenda de foto/PDF
//   pendencias_do_cliente   "o que falta para a Ladies?"
//   concluir_acao           "concluí X da Showman" (ação ambígua → o Max pergunta qual e chama de novo com acao_id)
//   importar_conversa       conversa exportada do WhatsApp (.txt/.zip) que o Pedro mandou como documento
// Só o número do dono chega ao Max (roteado no webhook), então estas ferramentas também só valem para ele.
import { CentralErro, criarClienteCentral, type ClienteCentral } from "@/lib/integracoes/avanteza-central";

export const CHAVE_IMPORTACAO_PENDENTE = "max-importacao-pendente";
export interface ImportacaoPendente { mediaId: string; arquivo: string; recebidoEm: string }

export interface DepsCentral {
  central?: ClienteCentral;
  /** Arquivo exportado que chegou como documento e ainda não foi importado. */
  lerPendente?: () => Promise<ImportacaoPendente | null>;
  limparPendente?: () => Promise<void>;
  baixar?: (mediaId: string) => Promise<Buffer>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "sem prazo");
const central = (deps: DepsCentral) => deps.central ?? criarClienteCentral();

/** Erro da Central em texto para o modelo (com a instrução do que fazer a seguir). */
function explicar(e: unknown, cliente: string): string {
  if (e instanceof CentralErro) {
    if (e.codigo === "ambiguo" && e.opcoes?.candidatos?.length) {
      return `CLIENTE AMBIGUO: "${cliente}" bate com mais de um cliente: ${e.opcoes.candidatos.join(", ")}. Pergunte ao Pedro qual deles e chame a ferramenta de novo com o nome exato.`;
    }
    if (e.codigo === "nao-encontrado" && /cliente/i.test(e.message)) return `Cliente "${cliente}" nao encontrado na Central. Pergunte ao Pedro o nome certo do cliente.`;
    if (e.codigo === "nao-configurado" || e.codigo === "nao-autorizado") return `A integracao com a Central nao esta configurada (${e.message}). Avise o Pedro; nada foi registrado.`;
    return `Nao deu certo: ${e.message} Nada foi alterado; avise o Pedro.`;
  }
  return "Nao consegui falar com a Central agora. Nada foi registrado; avise o Pedro e sugira tentar de novo em instantes.";
}

export async function registrarParaCliente(args: Record<string, unknown>, deps: DepsCentral = {}): Promise<string> {
  const cliente = str(args.cliente);
  const conteudo = str(args.conteudo) || str(args.texto);
  const tipo = str(args.tipo) || "texto";
  if (cliente.length < 2) return "Faltou o cliente. Pergunte ao Pedro para qual cliente e esse registro.";
  if (!conteudo) return "Faltou o conteudo a registrar. Peca ao Pedro o texto (ou reenvie o audio).";
  try {
    const r = await central(deps).registrar({
      cliente,
      texto: tipo === "audio" ? null : tipo === "encaminhada" ? `[mensagem encaminhada] ${conteudo}` : tipo === "legenda" ? `[legenda de midia] ${conteudo}` : conteudo,
      transcricao: tipo === "audio" ? conteudo : null,
      autor: str(args.autor) || "Pedro (via Max)",
      data: /^\d{4}-\d{2}-\d{2}$/.test(str(args.data)) ? str(args.data) : null,
    });
    if (r.duplicada) return `Isso ja estava registrado para ${cliente} (nada duplicado).`;
    if (r.status === "sem_ia") return `Registrado para ${cliente}. A IA da Central esta desligada, entao nenhuma acao foi criada automaticamente.`;
    if (r.status === "erro") return `Registrado para ${cliente}, mas a analise automatica falhou; a equipe ve a captura na Central.`;
    if (!r.acoes.length) return `Registrado para ${cliente}. Nenhum combinado novo identificado.`;
    return [`Registrado para ${cliente}. ${r.acoesCriadas} acao(oes) criada(s) no plano (selo IA, pode desfazer na Central):`, ...r.acoes.map((a) => `- ${a.titulo} (${a.responsavel === "cliente" ? "cliente" : "Avanteza"}, ${dataBR(a.prazo)})`)].join("\n");
  } catch (e) {
    return explicar(e, cliente);
  }
}

export async function pendenciasDoCliente(args: Record<string, unknown>, deps: DepsCentral = {}): Promise<string> {
  const cliente = str(args.cliente);
  if (cliente.length < 2) return "Faltou o cliente. Pergunte ao Pedro de qual cliente.";
  try {
    const r = await central(deps).pendencias(cliente);
    if (!r.total) return `${r.cliente.nome}: nenhuma acao aberta.`;
    const linhas = r.acoes.map((a) => `- [id:${a.id}] ${a.titulo} — ${a.responsavel === "cliente" ? "cliente" : "Avanteza"}, ${dataBR(a.prazo)}${a.atrasada ? " (ATRASADA)" : ""}${a.status === "bloqueada" ? " (bloqueada)" : ""}`);
    const resto = r.total - r.acoes.length;
    return [`${r.cliente.nome}: ${r.total} acao(oes) aberta(s), ${r.atrasadas} atrasada(s), ${r.doCliente} dependem do cliente.`, ...linhas, ...(resto > 0 ? [`(+${resto} mais adiante no plano)`] : [])].join("\n");
  } catch (e) {
    return explicar(e, cliente);
  }
}

export async function concluirAcao(args: Record<string, unknown>, deps: DepsCentral = {}): Promise<string> {
  const cliente = str(args.cliente);
  const acao = str(args.acao);
  const acaoId = str(args.acao_id);
  if (cliente.length < 2) return "Faltou o cliente. Pergunte ao Pedro de qual cliente e a acao.";
  if (!acao && !acaoId) return "Faltou dizer qual acao foi concluida.";
  try {
    const r = await central(deps).concluir({ cliente, ...(acaoId ? { acaoId } : { acao }) });
    return `Concluida na Central: "${r.concluida.titulo}" (${r.cliente.nome}).`;
  } catch (e) {
    if (e instanceof CentralErro && e.codigo === "ambiguo" && e.opcoes?.opcoes?.length) {
      return [
        `MAIS DE UMA ACAO PARECIDA para ${cliente}. NAO conclua nada ainda: pergunte ao Pedro qual (mostre numerado) e depois chame concluir_acao com o acao_id escolhido:`,
        ...e.opcoes.opcoes.map((o, i) => `${i + 1}) [acao_id:${o.id}] ${o.titulo} (${dataBR(o.prazo)})`),
      ].join("\n");
    }
    if (e instanceof CentralErro && e.codigo === "nao-encontrado" && !/cliente/i.test(e.message)) {
      return `Nao achei acao aberta parecida com "${acao || acaoId}" para ${cliente}. Use pendencias_do_cliente para ver a lista e confirme com o Pedro.`;
    }
    return explicar(e, cliente);
  }
}

async function pendentePadrao(): Promise<ImportacaoPendente | null> {
  const { prisma } = await import("@/lib/prisma/client");
  const r = await prisma.contextoPedro.findUnique({ where: { chave: CHAVE_IMPORTACAO_PENDENTE } });
  try { return r ? (JSON.parse(r.valor) as ImportacaoPendente) : null; } catch { return null; }
}
async function limparPadrao() {
  const { prisma } = await import("@/lib/prisma/client");
  await prisma.contextoPedro.deleteMany({ where: { chave: CHAVE_IMPORTACAO_PENDENTE } });
}
async function baixarPadrao(mediaId: string): Promise<Buffer> {
  const [{ fetchMetaMediaWithTimeout }, { getOwnerProvider, resolveToken }] = await Promise.all([import("../media"), import("../config")]);
  const p = await getOwnerProvider();
  return fetchMetaMediaWithTimeout(mediaId, resolveToken(p?.accessToken));
}

export async function importarConversa(args: Record<string, unknown>, deps: DepsCentral = {}): Promise<string> {
  const pendente = await (deps.lerPendente ?? pendentePadrao)();
  if (!pendente) return "Nao ha conversa exportada pendente. Peca ao Pedro para mandar o arquivo .txt ou .zip (WhatsApp: Mais > Exportar conversa) como documento.";
  const cliente = str(args.cliente) || null;
  let conteudo: Buffer;
  try {
    conteudo = await (deps.baixar ?? baixarPadrao)(pendente.mediaId);
  } catch {
    return "Nao consegui baixar o arquivo do WhatsApp (o link pode ter expirado). Peca ao Pedro para reenviar a conversa exportada.";
  }
  try {
    const r = await central(deps).importar({ cliente, arquivo: pendente.arquivo, conteudo });
    await (deps.limparPendente ?? limparPadrao)();
    if (!r.novas) return `Conversa "${r.titulo ?? pendente.arquivo}" ja estava importada (${r.duplicadas} mensagens, nada novo).`;
    return [
      `Conversa "${r.titulo ?? pendente.arquivo}" importada: ${r.novas} mensagem(ns) nova(s)${r.duplicadas ? ` (${r.duplicadas} ja estavam)` : ""}, ${r.acoesCriadas} acao(oes) criada(s).`,
      ...(r.audiosNaoTranscritos ? [`${r.audiosNaoTranscritos} audio(s) nao transcrito(s).`] : []),
      ...(r.semIa ? ["A IA da Central esta desligada: as mensagens ficaram registradas, sem extrair acoes."] : []),
    ].join(" ");
  } catch (e) {
    if (e instanceof CentralErro && e.codigo === "rejeitado" && /cliente/i.test(e.message)) {
      return "A Central nao sabe de qual cliente e esta conversa. Pergunte ao Pedro e chame importar_conversa com o nome do cliente.";
    }
    return explicar(e, cliente ?? "");
  }
}

/** Documento que é conversa exportada do WhatsApp (.txt/.zip) — vai para importar_conversa, não para leitura financeira. */
export function ehConversaExportada(filename: string | null | undefined, mimeType: string | null | undefined): boolean {
  const n = (filename ?? "").toLowerCase();
  const m = (mimeType ?? "").toLowerCase();
  if (/\.(txt|zip)$/.test(n)) return true;
  return !n && (m.startsWith("text/plain") || m.includes("zip"));
}
