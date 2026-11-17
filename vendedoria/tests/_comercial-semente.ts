// Semente do CRM antigo (schema `crm`) para testar scripts/comercial-copiar.mjs sem tocar em produção.
// O schema `crm` é criado a partir de tests/fixtures/crm-schema.prisma (cópia do schema do CRM antigo, desligado em 2026-11-17).
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

const RAIZ = process.cwd(); // vendedoria/
const PRISMA = path.join(RAIZ, "node_modules", ".bin", "prisma");

/** Cria o schema `crm` vazio (DDL gerado do schema Prisma do CRM). Recria se já existir. */
export function criarSchemaCrm(url: string) {
  const diff = spawnSync(PRISMA, ["migrate", "diff", "--from-empty", "--to-schema-datamodel", path.join(RAIZ, "tests", "fixtures", "crm-schema.prisma"), "--script"], { encoding: "utf8", cwd: RAIZ });
  if (diff.status !== 0) throw new Error(`prisma migrate diff falhou: ${diff.stderr}`);
  const sql = `DROP SCHEMA IF EXISTS crm CASCADE;\nCREATE SCHEMA crm;\nSET search_path TO crm;\n${diff.stdout}`;
  const r = spawnSync(PRISMA, ["db", "execute", "--stdin", "--url", url], { input: sql, encoding: "utf8", cwd: RAIZ });
  if (r.status !== 0) throw new Error(`criar schema crm falhou: ${r.stderr}`);
}

let seq = 0;
const id = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`;
class Json { constructor(readonly v: unknown) {} }
const json = (v: unknown) => new Json(v);
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (v instanceof Json) return `'${JSON.stringify(v.v).replace(/'/g, "''")}'::jsonb`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(",")}]::text[]`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
async function ins(db: PrismaClient, tabela: string, linhas: Record<string, unknown>[]) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const valores = linhas.map((l) => `(${cols.map((c) => lit(l[c])).join(",")})`).join(",\n");
  await db.$executeRawUnsafe(`insert into ${tabela} (${cols.map((c) => `"${c}"`).join(",")}) values ${valores}`);
}

const EMPRESAS = ["Padaria Estrela", "Oficina Rocha", "Casa & Cia Móveis", "Clínica Vitta", "Mercado União", "Mercado Alvorada", "Auto Peças Goiás", "Ótica Visão", "Pet Shop Amigo", "Farmácia Bem Estar",
  "Academia Força", "Restaurante Sabor", "Loja Moda Viva", "Material de Construção Forte", "Distribuidora Central", "Barbearia Dom", "Studio Bela", "Escola Saber", "Hortifruti Verde", "Gráfica Rápida"];
const PESSOAS = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Alves", "Elisa Rocha", "Fábio Nunes", "Gabriela Melo", "Henrique Costa", "Isabela Reis", "João Pedro", "Karina Torres", "Lucas Martins",
  "Mariana Prado", "Nelson Faria", "Olívia Ramos", "Paulo Henrique", "Queila Santos", "Rafael Moura", "Sabrina Lopes", "Tiago Barros"];
const ETAPAS = [["Leads", "ABERTA"], ["Qualificação", "ABERTA"], ["Proposta e negociação", "ABERTA"], ["Contrato", "ABERTA"], ["Ganha", "GANHA"], ["Perdida", "PERDIDA"]] as const;
const MOTIVOS: Array<[string, string]> = [["PERDA", "Sem interesse"], ["PERDA", "Fora do perfil (ICP)"], ["PERDA", "Preço"], ["PERDA", "Sem orçamento"], ["PERDA", "Sem retorno do cliente"],
  ["PERDA", "Escolheu concorrente"], ["PERDA", "Adiou a decisão"], ["PERDA", "Não é o decisor"], ["PERDA", "Contato inválido ou spam"], ["PERDA", "Pediu para não receber mensagens"],
  ["GANHO", "Dor confirmada e urgente"], ["GANHO", "Prova de valor aceita"], ["GANHO", "Preço e condições"], ["GANHO", "Indicação ou confiança"], ["GANHO", "Atendimento rápido"]];

export interface Semente { orgId: string; oportunidades: number; contatos: number; usuarioNovoEmail: string }

/**
 * Preenche o CRM antigo com dados parecidos com os de produção (funil Vendas, contatos ligados a Leads,
 * oportunidades em todas as etapas, histórico, feedback, tarefas com subtarefa, compromisso, entrega,
 * proposta, mensagens, motivos). Cria também a organização, colunas e Leads no lado do Vendedor IA.
 */
export async function semearCrm(db: PrismaClient, opcoes: { quantidade?: number; emailsExistentes?: string[]; orgId?: string } = {}): Promise<Semente> {
  const n = opcoes.quantidade ?? 24;
  const agora = Date.now();
  const dia = 86_400_000;

  // Vendedor IA: organização, colunas canônicas e Leads.
  let orgId = opcoes.orgId;
  if (!orgId) {
    orgId = id("org");
    await ins(db, `public."WhatsappBusinessOrganization"`, [{ id: orgId, name: "Avanteza (teste)", documentId: "00000000000100", documentType: "CNPJ", updatedAt: new Date() }]);
  }
  const colunas: Record<string, string> = {};
  const existentes = await db.kanbanColumn.findMany({ where: { organizationId: orgId } });
  for (const [ordem, [tipo, nome]] of ([["TRIAGE", "Leads"], ["EM_QUALIFICACAO", "Qualificação"], ["PROPOSTA_NEGOCIACAO", "Proposta e Negociação"], ["CONTRATO", "Contrato"], ["GANHO", "Ganho"], ["LOST", "Perdido"]] as const).entries()) {
    const ja = existentes.find((c) => c.type === tipo);
    if (ja) { colunas[tipo] = ja.id; continue; }
    colunas[tipo] = id("kc");
    await ins(db, `public."KanbanColumn"`, [{ id: colunas[tipo], name: nome, order: ordem, type: tipo, organizationId: orgId, color: "#0b1b33", isDefaultEntry: ordem === 0 }]);
  }
  const leads: string[] = [];
  for (let i = 0; i < n; i++) {
    const lid = id("lead");
    leads.push(lid);
    await ins(db, `public."Lead"`, [{ id: lid, phoneNumber: `55629${String(80000000 + i * 7919).slice(0, 8)}`, profileName: PESSOAS[i % PESSOAS.length], leadOrigin: "INBOUND", organizationId: orgId, kanbanColumnId: colunas.EM_QUALIFICACAO, updatedAt: new Date(), empresa: EMPRESAS[i % EMPRESAS.length] }]);
  }

  // CRM: usuários (2 casam por e-mail com User, 1 não existe no Vendedor IA), funil, etapas, motivos.
  const emails = opcoes.emailsExistentes ?? [];
  const usuarioNovoEmail = `${id("novo")}@avanteza.test`;
  const usuarios = [
    { id: id("u"), nome: "Pedro (CRM)", email: (emails[0] ?? `${id("a")}@avanteza.test`).toUpperCase(), senhaHash: "x", papel: "ADMIN", ativo: true },
    { id: id("u"), nome: "Vendedor (CRM)", email: emails[1] ?? `${id("b")}@avanteza.test`, senhaHash: "x", papel: "VENDEDOR", ativo: true },
    { id: id("u"), nome: "Consultora Nova", email: usuarioNovoEmail, senhaHash: "x", papel: "VENDEDOR", ativo: true },
  ];
  await ins(db, `crm."Usuario"`, usuarios);
  const funilId = id("fun");
  await ins(db, `crm."Funil"`, [{ id: funilId, nome: "Vendas", ordem: 0, padrao: true, ativo: true }]);
  const etapas = ETAPAS.map(([nome, tipo], ordem) => ({ id: id("et"), funilId, nome, ordem, tipo, descricao: tipo === "ABERTA" ? `Orientação da etapa ${nome}. AÇÃO: avançar.` : null }));
  await ins(db, `crm."Etapa"`, etapas);
  const motivos = MOTIVOS.map(([tipo, nome], ordem) => ({ id: id("mot"), tipo, nome, ordem, ativo: true }));
  await ins(db, `crm."MotivoEncerramento"`, motivos);

  // Contatos: empresa + pessoa ligada ao Lead (como a integração cria).
  const empresas = [], pessoas = [];
  for (let i = 0; i < n; i++) {
    const e = { id: id("ce"), tipo: "EMPRESA", nome: `${EMPRESAS[i % EMPRESAS.length]}${i >= EMPRESAS.length ? ` ${Math.floor(i / EMPRESAS.length) + 1}` : ""}`, telefone: null, email: null, documento: null, segmento: ["Varejo", "Serviços", "Saúde", "Alimentação"][i % 4], cargo: null, cicloDeVida: "LEAD", origem: "Vendedor IA", empresaId: null, responsavelId: usuarios[i % 2].id, vendedorIaLeadId: null, criadoEm: new Date(agora - (40 - i) * dia), atualizadoEm: new Date() };
    // A última pessoa aponta para um Lead que não existe: a cópia grava leadId nulo.
    const p = { id: id("cp"), tipo: "PESSOA", nome: PESSOAS[i % PESSOAS.length], telefone: `55629${String(80000000 + i * 7919).slice(0, 8)}`, email: `${PESSOAS[i % PESSOAS.length].split(" ")[0].toLowerCase()}${i}@cliente.test`, documento: null, segmento: null, cargo: "Dono(a)", cicloDeVida: "LEAD", origem: "Vendedor IA", empresaId: e.id, responsavelId: null, vendedorIaLeadId: i === n - 1 ? "lead-que-nao-existe" : leads[i], criadoEm: new Date(agora - (40 - i) * dia), atualizadoEm: new Date() };
    empresas.push(e); pessoas.push(p);
  }
  await ins(db, `crm."Contato"`, empresas);
  await ins(db, `crm."Contato"`, pessoas);

  // Oportunidades distribuídas pelas etapas; ganhas e perdidas com motivo.
  const ops = [], hist = [], feed = [];
  for (let i = 0; i < n; i++) {
    const etapa = etapas[i % 6 === 5 ? 5 : i % 6 === 4 ? 4 : i % 4];
    const criadoEm = new Date(agora - (30 - (i % 30)) * dia);
    const desde = new Date(criadoEm.getTime() + 2 * dia);
    const status = etapa.tipo === "GANHA" ? "GANHA" : etapa.tipo === "PERDIDA" ? "PERDIDA" : "EM_ANDAMENTO";
    const motivo = status === "PERDIDA" ? motivos[i % 10] : status === "GANHA" ? motivos[10 + (i % 5)] : null;
    const oid = id("op");
    ops.push({
      id: oid, numero: i + 1, nome: `${empresas[i].nome} — ${["gestão", "vendas e processos", "marketing", "implantação"][i % 4]}`, contatoId: empresas[i].id, pessoaId: pessoas[i].id, funilId, etapaId: etapa.id, status,
      responsavelId: i % 3 === 2 ? usuarios[2].id : usuarios[i % 2].id, valorUnico: (i % 5) * 4500, valorMensal: status === "GANHA" ? 2500 : (i % 3) * 900, probabilidade: ["FRIA", "MORNA", "QUENTE", "RISCO_ALTO"][i % 4],
      origem: "Vendedor IA", tags: i % 2 ? ["vendedor-ia"] : ["vendedor-ia", "indicação"], finalizaEm: new Date(agora + ((i % 7) - 2) * dia), etapaDesdeEm: desde, encerradaEm: status === "EM_ANDAMENTO" ? null : desde,
      motivoId: motivo?.id ?? null, motivoDetalhe: motivo ? "Detalhe do encerramento" : null, ultimaAtividadeEm: new Date(agora - (i % 12) * dia), vendedorIaLeadId: i === n - 1 ? "lead-que-nao-existe" : leads[i],
      criadoEm, atualizadoEm: new Date(), resumoIa: null, resumoIaEm: null,
    });
    hist.push({ id: id("he"), oportunidadeId: oid, deEtapaId: null, deFunilNome: null, deEtapaNome: null, paraEtapaId: etapas[0].id, paraFunilNome: "Vendas", paraEtapaNome: "Leads", paraTipo: "ABERTA", entrouEm: criadoEm, saiuEm: etapa.id === etapas[0].id ? null : desde, origem: "INTEGRACAO", ator: "vendedor-ia", motivo: null });
    if (etapa.id !== etapas[0].id) hist.push({ id: id("he"), oportunidadeId: oid, deEtapaId: etapas[0].id, deFunilNome: "Vendas", deEtapaNome: "Leads", paraEtapaId: etapa.id, paraFunilNome: "Vendas", paraEtapaNome: etapa.nome, paraTipo: etapa.tipo, entrouEm: desde, saiuEm: null, origem: "MANUAL", ator: usuarios[0].id, motivo: null });
    feed.push({ id: id("fb"), oportunidadeId: oid, contatoId: null, tipo: "SISTEMA", texto: "O Vendedor IA qualificou o lead.", intencao: null, importante: false, autor: "vendedor-ia", autorNome: "Vendedor IA", criadoEm: criadoEm });
    if (i % 3 === 0) feed.push({ id: id("fb"), oportunidadeId: oid, contatoId: null, tipo: "LIGACAO", texto: "Liguei e o dono pediu proposta até sexta.", intencao: "PEDIU_PROPOSTA", importante: i % 6 === 0, autor: usuarios[0].id, autorNome: "Pedro (CRM)", criadoEm: desde });
  }
  await ins(db, `crm."Oportunidade"`, ops);
  await ins(db, `crm."HistoricoEtapa"`, hist);
  await ins(db, `crm."Feedback"`, feed);
  await db.$executeRawUnsafe(`select setval(pg_get_serial_sequence('crm."Oportunidade"','numero'), ${n})`);

  // Tarefas (uma com subtarefa), compromisso com participantes, mensagens (uma da extensão: fica de fora).
  const pai = id("tar");
  await ins(db, `crm."Tarefa"`, [
    { id: pai, titulo: "Ligar para o dono e confirmar a proposta", descricao: null, tipo: "LIGACAO", prioridade: "ALTA", prazoEm: new Date(agora + 3 * 3_600_000), status: "ABERTA", concluidaEm: null, recorrencia: null, checklist: json([{ texto: "Revisar a conversa", feito: true }]), origem: "MANUAL", responsavelId: usuarios[0].id, contatoId: null, oportunidadeId: ops[1].id, paiId: null, criadoEm: new Date(), atualizadoEm: new Date() },
    { id: id("tar"), titulo: "Assumir a conversa de Bruno", descricao: null, tipo: "WHATSAPP", prioridade: "ALTA", prazoEm: new Date(agora - dia), status: "ABERTA", concluidaEm: null, recorrencia: null, checklist: json([]), origem: "INTEGRACAO", responsavelId: usuarios[2].id, contatoId: null, oportunidadeId: ops[2].id, paiId: null, criadoEm: new Date(), atualizadoEm: new Date() },
    { id: id("tar"), titulo: "Enviar contrato", descricao: "Modelo Growth Engine", tipo: "EMAIL", prioridade: "NORMAL", prazoEm: new Date(agora + 2 * dia), status: "CONCLUIDA", concluidaEm: new Date(), recorrencia: null, checklist: json([]), origem: "MANUAL", responsavelId: usuarios[1].id, contatoId: null, oportunidadeId: ops[3].id, paiId: null, criadoEm: new Date(), atualizadoEm: new Date() },
  ]);
  await ins(db, `crm."Tarefa"`, [{ id: id("tar"), titulo: "Separar o diagnóstico de margem", descricao: null, tipo: "TAREFA", prioridade: "NORMAL", prazoEm: null, status: "ABERTA", concluidaEm: null, recorrencia: null, checklist: json([]), origem: "MANUAL", responsavelId: usuarios[0].id, contatoId: null, oportunidadeId: ops[1].id, paiId: pai, criadoEm: new Date(), atualizadoEm: new Date() }]);
  await ins(db, `crm."Compromisso"`, [{ id: id("cmp"), assunto: "Reunião de assinatura do contrato", tipo: "REUNIAO", inicio: new Date(agora + 26 * 3_600_000), fim: new Date(agora + 27 * 3_600_000), local: "Google Meet", descricao: null, status: "AGENDADO", participantes: ["cliente@empresa.test", "pedro@avanteza.test"], origem: "MANUAL", responsavelId: usuarios[0].id, contatoId: null, oportunidadeId: ops[3].id, criadoEm: new Date() }]);
  await ins(db, `crm."Mensagem"`, [
    { id: id("msg"), contatoId: pessoas[0].id, oportunidadeId: ops[0].id, canal: "WHATSAPP", autor: "Vendedor IA", deMim: true, texto: "Oi! Vi que você tem loja física. Qual o faturamento médio?", enviadaEm: new Date(agora - 2 * dia), origem: "VENDEDOR_IA", hash: id("h"), analisadaEm: null, criadoEm: new Date() },
    { id: id("msg"), contatoId: pessoas[0].id, oportunidadeId: ops[0].id, canal: "WHATSAPP", autor: PESSOAS[0], deMim: false, texto: "Uns 60 mil por mês.", enviadaEm: new Date(agora - 2 * dia + 60_000), origem: "VENDEDOR_IA", hash: id("h"), analisadaEm: null, criadoEm: new Date() },
    { id: id("msg"), contatoId: pessoas[1].id, oportunidadeId: null, canal: "WHATSAPP", autor: PESSOAS[1], deMim: false, texto: "mensagem da extensão", enviadaEm: new Date(agora - dia), origem: "EXTENSAO", hash: id("h"), analisadaEm: null, criadoEm: new Date() },
  ]);
  await ins(db, `crm."AnaliseAgente"`, [{ id: id("an"), oportunidadeId: ops[0].id, fonte: "FEEDBACK", fonteRef: feed[0].id, texto: "texto", status: "CONCLUIDA", resumo: "Cliente quer proposta", erro: null, sugestoes: 1, modelo: "claude-opus-5-5", tokensEntrada: 100, tokensSaida: 20, criadoEm: new Date(), concluidaEm: new Date() }]);

  // Entrega da primeira ganha, modelo padrão com itens, proposta, produto, meta, automação, evento.
  const modeloId = id("me");
  await ins(db, `crm."ModeloEntrega"`, [{ id: modeloId, nome: "Implantação padrão", descricao: null, padrao: true, ativo: true }]);
  await ins(db, `crm."ModeloEntregaItem"`, ["Reunião de início", "Diagnóstico por pilar", "Plano de 90 dias"].map((titulo, ordem) => ({ id: id("mi"), modeloId, titulo, descricao: null, pilar: ["COMERCIAL", "OPERACAO", "MARKETING"][ordem], prazoDias: 7 * (ordem + 1), cliente: ordem === 1, ordem, checklist: json([]) })));
  const ganha = ops.find((o) => o.status === "GANHA");
  if (ganha) {
    const entregaId = id("en");
    await ins(db, `crm."Entrega"`, [{ id: entregaId, oportunidadeId: ganha.id, contatoId: ganha.contatoId, nome: ganha.nome, status: "EM_ANDAMENTO", inicioEm: new Date(agora - 12 * dia), fimPrevistoEm: null, renovacaoEm: new Date(agora + 40 * dia), valorMensal: 2500, modeloId, diagnostico: {}, concluidaEm: null, renovacaoOportunidadeId: null, criadoEm: new Date(), atualizadoEm: new Date() }]);
    await ins(db, `crm."EntregaCartao"`, ["Reunião de início", "Diagnóstico por pilar", "Plano de 90 dias"].map((titulo, ordem) => ({ id: id("ec"), entregaId, titulo, descricao: null, pilar: ["COMERCIAL", "OPERACAO", "MARKETING"][ordem], coluna: ["CONCLUIDO", "AGUARDANDO_CLIENTE", "EM_ANDAMENTO"][ordem], ordem, dataAlvo: new Date(agora + (ordem - 1) * 7 * dia), cliente: ordem === 1, responsavelId: usuarios[0].id, checklist: json([]), colunaDesdeEm: new Date(agora - 9 * dia), planejadoEm: null, concluidoEm: ordem === 0 ? new Date() : null, criadoEm: new Date() })));
  }
  const produtoId = id("pr");
  await ins(db, `crm."Produto"`, [{ id: produtoId, nome: "Growth Engine", codigo: "GE", descricao: null, valor: 4500, recorrencia: "MENSAL", ativo: true, criadoEm: new Date() }]);
  await ins(db, `crm."OportunidadeProduto"`, [{ id: id("op"), oportunidadeId: ops[2].id, produtoId, nome: "Growth Engine", quantidade: 1, valorUnitario: 4500, desconto: 0, recorrencia: "MENSAL", criadoEm: new Date() }]);
  await ins(db, `crm."Proposta"`, [{ id: id("pp"), numero: 1, oportunidadeId: ops[2].id, versao: 1, status: "ENVIADA", titulo: "Proposta Growth Engine", introducao: "Introdução", condicoes: "Condições", itens: json([{ nome: "Growth Engine", quantidade: 1, valorUnitario: 4500, desconto: 0, recorrencia: "MENSAL", total: 4500 }]), valorUnico: 0, valorMensal: 4500, validaAte: new Date(agora + 10 * dia), token: id("tok") + id("tok"), enviadaEm: new Date(), visualizadaEm: null, respondidaEm: null, respostaNome: null, respostaComentario: null, criadoPorId: usuarios[0].id, criadoEm: new Date(), atualizadoEm: new Date() }]);
  await db.$executeRawUnsafe(`select setval(pg_get_serial_sequence('crm."Proposta"','numero'), 1)`);
  await ins(db, `crm."Meta"`, [{ id: id("mt"), escopo: "TODOS", ano: 2026, mes: 11, tipo: "TOTAL", valor: 50000, criadoEm: new Date(), atualizadoEm: new Date() }]);
  const autoId = id("au");
  await ins(db, `crm."Automacao"`, [{ id: autoId, nome: "Parada 3 dias", descricao: null, ativo: true, gatilho: "OPORTUNIDADE_ESTAGNADA", criterios: json([]), acoes: json([{ tipo: "CRIAR_TAREFA", titulo: "Retomar" }]), criadaPorId: usuarios[0].id, criadoEm: new Date(), atualizadoEm: new Date() }]);
  await ins(db, `crm."AutomacaoExecucao"`, [{ id: id("ax"), automacaoId: autoId, oportunidadeId: ops[0].id, referenciaId: null, gatilho: "OPORTUNIDADE_ESTAGNADA", indice: 0, acaoTipo: "CRIAR_TAREFA", chave: id("ch"), status: "EXECUTADA", executarEm: new Date(), executadaEm: new Date(), detalhe: null, criadoEm: new Date() }]);
  await ins(db, `crm."EventoIntegracao"`, [{ id: id("ev"), eventoId: id("evento-"), origem: "vendedor-ia", tipo: "lead.qualificado", payload: { tipo: "lead.qualificado" }, status: "PROCESSADO", detalhe: null, recebidoEm: new Date() }]);
  await ins(db, `crm."Configuracao"`, [{ chave: "google.clientSecret", valor: "cifrado-nao-copiar", atualizadoEm: new Date() }]);

  return { orgId, oportunidades: n, contatos: 2 * n, usuarioNovoEmail };
}
