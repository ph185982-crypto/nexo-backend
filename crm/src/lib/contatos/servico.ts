import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroEntrada } from "@/lib/validar";
import { normalizarTelefone } from "@/lib/integracao/vendedor-ia";
import { gerarCsv, lerCsv } from "./csv";

import { CICLOS, ROTULO_CICLO, TIPOS_CONTATO } from "./rotulos";
export { CICLOS, ROTULO_CICLO, TIPOS_CONTATO };

/** Contato duplicado: a rota responde 409 com o id do existente. */
export class ErroDuplicado extends Error { constructor(public existenteId: string, motivo: string) { super(motivo); } }

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const normalizarEmail = (e: string | null | undefined) => { const v = (e ?? "").trim().toLowerCase(); return v && emailValido(v) ? v : null; };

export interface DadosContato {
  tipo: string; nome: string; telefone?: string | null; email?: string | null; documento?: string | null; segmento?: string | null; cargo?: string | null;
  cicloDeVida?: string; origem?: string | null; empresaId?: string | null; responsavelId?: string | null;
}

async function procurarDuplicado(telefone: string | null, email: string | null, ignorarId?: string) {
  if (!telefone && !email) return null;
  return prisma.contato.findFirst({
    where: { ...(ignorarId ? { id: { not: ignorarId } } : {}), OR: [...(telefone ? [{ telefone }] : []), ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])] },
    select: { id: true, telefone: true },
  });
}

async function validarEmpresa(empresaId: string | null | undefined, tipo: string) {
  if (!empresaId) return;
  if (tipo !== "PESSOA") throw new ErroEntrada("Só uma pessoa pode estar vinculada a uma empresa");
  const e = await prisma.contato.findUnique({ where: { id: empresaId }, select: { tipo: true } });
  if (!e || e.tipo !== "EMPRESA") throw new ErroEntrada("Empresa não encontrada");
}

export async function criarContato(d: DadosContato) {
  if (!(TIPOS_CONTATO as readonly string[]).includes(d.tipo)) throw new ErroEntrada("tipo inválido");
  const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
  if (d.telefone && !telefone) throw new ErroEntrada("Telefone inválido (use DDD + número)");
  const email = d.email ? normalizarEmail(d.email) : null;
  if (d.email && !email) throw new ErroEntrada("E-mail inválido");
  await validarEmpresa(d.empresaId, d.tipo);
  const dup = await procurarDuplicado(telefone, email);
  if (dup) throw new ErroDuplicado(dup.id, dup.telefone === telefone && telefone ? "Já existe um contato com este telefone" : "Já existe um contato com este e-mail");
  return prisma.contato.create({ data: { tipo: d.tipo, nome: d.nome, telefone, email, documento: d.documento ?? null, segmento: d.segmento ?? null, cargo: d.cargo ?? null, cicloDeVida: d.cicloDeVida ?? "LEAD", origem: d.origem ?? null, empresaId: d.empresaId ?? null, responsavelId: d.responsavelId ?? null } });
}

export async function atualizarContato(id: string, d: Partial<Omit<DadosContato, "tipo">>) {
  const atual = await prisma.contato.findUnique({ where: { id } });
  if (!atual) return null;
  const telefone = d.telefone === undefined ? undefined : d.telefone ? normalizarTelefone(d.telefone) : null;
  if (d.telefone && !telefone) throw new ErroEntrada("Telefone inválido (use DDD + número)");
  const email = d.email === undefined ? undefined : d.email ? normalizarEmail(d.email) : null;
  if (d.email && !email) throw new ErroEntrada("E-mail inválido");
  if (d.cicloDeVida !== undefined && !(CICLOS as readonly string[]).includes(d.cicloDeVida)) throw new ErroEntrada("ciclo de vida inválido");
  if (d.empresaId !== undefined) { if (d.empresaId === id) throw new ErroEntrada("Um contato não pode ser vinculado a si mesmo"); await validarEmpresa(d.empresaId, atual.tipo); }
  const dup = await procurarDuplicado(telefone === undefined ? null : telefone, email === undefined ? null : email, id);
  if (dup) throw new ErroDuplicado(dup.id, "Já existe outro contato com este telefone ou e-mail");
  return prisma.contato.update({
    where: { id },
    data: {
      ...(d.nome !== undefined && { nome: d.nome }), ...(telefone !== undefined && { telefone }), ...(email !== undefined && { email }),
      ...(d.documento !== undefined && { documento: d.documento }), ...(d.segmento !== undefined && { segmento: d.segmento }), ...(d.cargo !== undefined && { cargo: d.cargo }),
      ...(d.cicloDeVida !== undefined && { cicloDeVida: d.cicloDeVida }), ...(d.origem !== undefined && { origem: d.origem }), ...(d.empresaId !== undefined && { empresaId: d.empresaId }),
    },
  });
}

export async function detalheContato(id: string) {
  const c = await prisma.contato.findUnique({
    where: { id },
    include: {
      empresa: { select: { id: true, nome: true } }, pessoas: { select: { id: true, nome: true, telefone: true, cargo: true }, orderBy: { nome: "asc" } },
      oportunidades: { orderBy: { criadoEm: "desc" }, take: 50, select: { id: true, numero: true, nome: true, status: true, valorUnico: true, valorMensal: true, criadoEm: true, etapa: { select: { nome: true } } } },
      tarefas: { where: { status: "ABERTA" }, orderBy: { prazoEm: { sort: "asc", nulls: "last" } }, take: 20, select: { id: true, titulo: true, prazoEm: true, prioridade: true } },
      feedbacks: { orderBy: { criadoEm: "desc" }, take: 30, select: { id: true, tipo: true, texto: true, intencao: true, autorNome: true, criadoEm: true } },
      entregas: { select: { id: true, nome: true, status: true } },
    },
  });
  if (!c) return null;
  return { ...c, oportunidades: c.oportunidades.map((o) => ({ ...o, valorUnico: Number(o.valorUnico.toString()), valorMensal: Number(o.valorMensal.toString()) })) };
}

export async function excluirContato(id: string): Promise<boolean> {
  const c = await prisma.contato.findUnique({ where: { id }, select: { _count: { select: { oportunidades: true, comoPessoaEm: true, entregas: true } } } });
  if (!c) return false;
  const n = c._count.oportunidades + c._count.comoPessoaEm + c._count.entregas;
  if (n > 0) throw new ErroEntrada("Este contato tem oportunidades ou entregas. Mescle-o com outro contato em vez de excluir.");
  await prisma.contato.delete({ where: { id } });
  return true;
}

// ─── Importação por CSV ──────────────────────────────────────────────────────
const sinonimos: Record<string, string[]> = {
  nome: ["nome", "name", "contato", "cliente", "razaosocial", "nomecompleto"], telefone: ["telefone", "celular", "whatsapp", "fone", "phone", "tel", "telefonecelular"],
  email: ["email", "emailcontato", "mail"], empresa: ["empresa", "company", "nomefantasia", "organizacao"], segmento: ["segmento", "ramo", "setor"], cargo: ["cargo", "funcao"],
  documento: ["cnpj", "cpf", "documento", "cnpjcpf"], origem: ["origem", "fonte", "source"], tipo: ["tipo", "tipodecontato"], ciclo: ["ciclodevida", "ciclo", "estagio"],
};
const normCab = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const CICLO_DO_TEXTO: Record<string, string> = { lead: "LEAD", prospect: "PROSPECT", cliente: "CLIENTE", descartado: "DESCARTADO" };

export const LIMITE_LINHAS_IMPORTACAO = 5000;
export const LIMITE_BYTES_IMPORTACAO = 2_000_000;

export interface ResultadoImportacao {
  total: number; criados: number; duplicados: number; invalidos: number; camposIgnorados: number; simulacao: boolean;
  colunasReconhecidas: string[]; colunasIgnoradas: string[]; problemas: Array<{ linha: number; motivo: string }>;
}

export async function importarCsv(texto: string, o: { simular: boolean; responsavelId: string | null }): Promise<ResultadoImportacao> {
  if (texto.length > LIMITE_BYTES_IMPORTACAO) throw new ErroEntrada("Arquivo grande demais (máximo de 2 MB)");
  const linhas = lerCsv(texto);
  if (linhas.length < 2) throw new ErroEntrada("O arquivo precisa ter o cabeçalho e ao menos uma linha");
  if (linhas.length - 1 > LIMITE_LINHAS_IMPORTACAO) throw new ErroEntrada(`Máximo de ${LIMITE_LINHAS_IMPORTACAO} linhas por importação`);
  const cab = linhas[0].map(normCab);
  const col = (campo: string) => cab.findIndex((h) => sinonimos[campo].includes(h));
  const idx = Object.fromEntries(Object.keys(sinonimos).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.nome < 0) throw new ErroEntrada('Não encontrei a coluna de nome (cabeçalho "nome").');
  const reconhecidas = Object.entries(idx).filter(([, i]) => i >= 0).map(([k]) => k);
  const usados = new Set(Object.values(idx).filter((i) => i >= 0));
  const res: ResultadoImportacao = { total: linhas.length - 1, criados: 0, duplicados: 0, invalidos: 0, camposIgnorados: 0, simulacao: o.simular, colunasReconhecidas: reconhecidas, colunasIgnoradas: linhas[0].filter((_, i) => !usados.has(i)), problemas: [] };
  const problema = (linha: number, motivo: string) => { if (res.problemas.length < 50) res.problemas.push({ linha, motivo }); };

  // Contatos que já existem (telefone e e-mail) + os que esta importação acabou de ver.
  const existentes = await prisma.contato.findMany({ where: { OR: [{ telefone: { not: null } }, { email: { not: null } }] }, select: { telefone: true, email: true } });
  const telefones = new Set(existentes.map((e) => e.telefone).filter((x): x is string => !!x));
  const emails = new Set(existentes.map((e) => e.email?.toLowerCase()).filter((x): x is string => !!x));
  const empresasCache = new Map<string, string>();

  for (const [n, l] of linhas.slice(1).entries()) {
    const numero = n + 2;
    const v = (campo: string) => (idx[campo] >= 0 ? (l[idx[campo]] ?? "").trim() : "");
    const nome = v("nome").slice(0, 200);
    if (!nome) { res.invalidos++; problema(numero, "Sem nome"); continue; }
    const telCru = v("telefone"), emailCru = v("email");
    const telefone = telCru ? normalizarTelefone(telCru) : null, email = emailCru ? normalizarEmail(emailCru) : null;
    if (telCru && !telefone) { res.camposIgnorados++; problema(numero, `Telefone "${telCru.slice(0, 30)}" ignorado (inválido)`); }
    if (emailCru && !email) { res.camposIgnorados++; problema(numero, `E-mail "${emailCru.slice(0, 40)}" ignorado (inválido)`); }
    if ((telefone && telefones.has(telefone)) || (email && emails.has(email))) { res.duplicados++; continue; }
    if (telefone) telefones.add(telefone);
    if (email) emails.add(email);

    const empresaNome = v("empresa").slice(0, 200);
    const tipoTexto = normCab(v("tipo"));
    const tipo = tipoTexto === "empresa" || tipoTexto === "pj" ? "EMPRESA" : "PESSOA";
    res.criados++;
    if (o.simular) continue;
    let empresaId: string | null = null;
    if (empresaNome && tipo === "PESSOA") {
      const chave = empresaNome.toLowerCase();
      empresaId = empresasCache.get(chave) ?? (await prisma.contato.findFirst({ where: { tipo: "EMPRESA", nome: { equals: empresaNome, mode: "insensitive" } }, select: { id: true } }))?.id ?? null;
      if (!empresaId) empresaId = (await prisma.contato.create({ data: { tipo: "EMPRESA", nome: empresaNome, segmento: v("segmento") || null, origem: v("origem") || "Importação", responsavelId: o.responsavelId } })).id;
      empresasCache.set(chave, empresaId);
    }
    await prisma.contato.create({
      data: { tipo, nome, telefone, email, documento: v("documento").slice(0, 30) || null, segmento: v("segmento").slice(0, 100) || null, cargo: v("cargo").slice(0, 100) || null, origem: v("origem").slice(0, 100) || "Importação", cicloDeVida: CICLO_DO_TEXTO[normCab(v("ciclo"))] ?? "LEAD", empresaId, responsavelId: o.responsavelId },
    });
  }
  return res;
}

// ─── Exportação ──────────────────────────────────────────────────────────────
export async function exportarCsv(): Promise<string> {
  const contatos = await prisma.contato.findMany({ orderBy: { criadoEm: "asc" }, include: { empresa: { select: { nome: true } } }, take: 50_000 });
  return gerarCsv([
    ["nome", "tipo", "telefone", "email", "empresa", "segmento", "cargo", "documento", "ciclo_de_vida", "origem", "criado_em"],
    ...contatos.map((c) => [c.nome, c.tipo === "EMPRESA" ? "Empresa" : "Pessoa", c.telefone, c.email, c.empresa?.nome ?? (c.tipo === "EMPRESA" ? c.nome : ""), c.segmento, c.cargo, c.documento, ROTULO_CICLO[c.cicloDeVida] ?? c.cicloDeVida, c.origem, c.criadoEm.toISOString()]),
  ]);
}

// ─── Duplicados e mesclagem ──────────────────────────────────────────────────
export async function acharDuplicados() {
  const [porTelefone, porEmail, porNome] = await Promise.all([
    prisma.$queryRaw<Array<{ valor: string }>>(Prisma.sql`SELECT telefone AS valor FROM "Contato" WHERE telefone IS NOT NULL GROUP BY telefone HAVING COUNT(*) > 1 LIMIT 100`),
    prisma.$queryRaw<Array<{ valor: string }>>(Prisma.sql`SELECT lower(email) AS valor FROM "Contato" WHERE email IS NOT NULL GROUP BY lower(email) HAVING COUNT(*) > 1 LIMIT 100`),
    prisma.$queryRaw<Array<{ valor: string; tipo: string }>>(Prisma.sql`SELECT lower(trim(nome)) AS valor, tipo FROM "Contato" GROUP BY lower(trim(nome)), tipo HAVING COUNT(*) > 1 LIMIT 100`),
  ]);
  const campos = { id: true, tipo: true, nome: true, telefone: true, email: true, cicloDeVida: true, _count: { select: { oportunidades: true } } } as const;
  const grupos: Array<{ motivo: "telefone" | "email" | "nome"; valor: string; contatos: Array<{ id: string; tipo: string; nome: string; telefone: string | null; email: string | null; cicloDeVida: string; oportunidades: number }> }> = [];
  const mapa = (cs: Array<{ id: string; tipo: string; nome: string; telefone: string | null; email: string | null; cicloDeVida: string; _count: { oportunidades: number } }>) => cs.map(({ _count, ...c }) => ({ ...c, oportunidades: _count.oportunidades }));
  for (const g of porTelefone) grupos.push({ motivo: "telefone", valor: g.valor, contatos: mapa(await prisma.contato.findMany({ where: { telefone: g.valor }, select: campos, orderBy: { criadoEm: "asc" } })) });
  for (const g of porEmail) grupos.push({ motivo: "email", valor: g.valor, contatos: mapa(await prisma.contato.findMany({ where: { email: { equals: g.valor, mode: "insensitive" } }, select: campos, orderBy: { criadoEm: "asc" } })) });
  for (const g of porNome) grupos.push({ motivo: "nome", valor: g.valor, contatos: mapa(await prisma.contato.findMany({ where: { tipo: g.tipo, nome: { equals: g.valor, mode: "insensitive" } }, select: campos, orderBy: { criadoEm: "asc" } })) });
  return grupos;
}

/** Junta `origemId` em `destinoId`: tudo o que apontava para a origem passa a apontar para o destino; campos vazios do destino são preenchidos. */
export async function mesclarContatos(origemId: string, destinoId: string) {
  if (origemId === destinoId) throw new ErroEntrada("Escolha dois contatos diferentes");
  return prisma.$transaction(async (tx) => {
    const [o, d] = await Promise.all([tx.contato.findUnique({ where: { id: origemId } }), tx.contato.findUnique({ where: { id: destinoId } })]);
    if (!o || !d) throw new ErroEntrada("Contato não encontrado");
    if (o.tipo !== d.tipo) throw new ErroEntrada("Só dá para mesclar empresa com empresa ou pessoa com pessoa");
    if (o.empresaId === d.id || d.empresaId === o.id) throw new ErroEntrada("Os contatos estão vinculados entre si");
    const movidos = {
      oportunidades: (await tx.oportunidade.updateMany({ where: { contatoId: o.id }, data: { contatoId: d.id } })).count,
      comoPessoa: (await tx.oportunidade.updateMany({ where: { pessoaId: o.id }, data: { pessoaId: d.id } })).count,
      tarefas: (await tx.tarefa.updateMany({ where: { contatoId: o.id }, data: { contatoId: d.id } })).count,
      feedbacks: (await tx.feedback.updateMany({ where: { contatoId: o.id }, data: { contatoId: d.id } })).count,
      compromissos: (await tx.compromisso.updateMany({ where: { contatoId: o.id }, data: { contatoId: d.id } })).count,
      entregas: (await tx.entrega.updateMany({ where: { contatoId: o.id }, data: { contatoId: d.id } })).count,
      pessoas: (await tx.contato.updateMany({ where: { empresaId: o.id }, data: { empresaId: d.id } })).count,
    };
    // vendedorIaLeadId é único: libera na origem antes de passar ao destino.
    const lead = !d.vendedorIaLeadId ? o.vendedorIaLeadId : null;
    await tx.contato.update({ where: { id: o.id }, data: { vendedorIaLeadId: null, telefone: null, email: null } });
    await tx.contato.update({
      where: { id: d.id },
      data: {
        telefone: d.telefone ?? o.telefone, email: d.email ?? o.email, documento: d.documento ?? o.documento, segmento: d.segmento ?? o.segmento, cargo: d.cargo ?? o.cargo, origem: d.origem ?? o.origem,
        empresaId: d.empresaId ?? o.empresaId, responsavelId: d.responsavelId ?? o.responsavelId, ...(lead ? { vendedorIaLeadId: lead } : {}),
        // o ciclo mais avançado vence (CLIENTE > PROSPECT > LEAD > DESCARTADO)
        cicloDeVida: (["CLIENTE", "PROSPECT", "LEAD", "DESCARTADO"] as const).find((c) => c === d.cicloDeVida || c === o.cicloDeVida) ?? d.cicloDeVida,
      },
    });
    await tx.contato.delete({ where: { id: o.id } });
    return movidos;
  });
}
