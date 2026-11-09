// Busca global (Ctrl+K) e avisos do sino. Leitura só: nada aqui grava.
import { prisma } from "@/lib/prisma";
import { codigoOportunidade } from "@/lib/funil/encerramento";
import { PARADO_CRITICO_DIAS } from "@/lib/formatar";

export const linkOportunidade = (o: { id: string; funilId: string }) => `/oportunidades?funil=${o.funilId}&abrir=${o.id}`;

export interface ResultadoBusca { tipo: "OPORTUNIDADE" | "CONTATO"; id: string; titulo: string; detalhe: string; href: string }

/** Nome, código (número da oportunidade), telefone, e-mail ou documento. Mínimo de 2 caracteres. */
export async function buscar(q: string, limite = 8): Promise<ResultadoBusca[]> {
  const termo = q.trim().slice(0, 80);
  if (termo.length < 2) return [];
  const digitos = termo.replace(/\D/g, "");
  const numero = /^\d{1,8}(\/\d{4})?$/.test(termo) ? Number(termo.split("/")[0]) : null;
  const [ops, contatos] = await Promise.all([
    prisma.oportunidade.findMany({
      where: { OR: [{ nome: { contains: termo, mode: "insensitive" } }, { contato: { nome: { contains: termo, mode: "insensitive" } } }, ...(numero ? [{ numero }] : [])] },
      select: { id: true, funilId: true, nome: true, numero: true, criadoEm: true, status: true, contato: { select: { nome: true } }, etapa: { select: { nome: true } } },
      orderBy: [{ status: "asc" /* EM_ANDAMENTO antes de GANHA/PERDIDA */ }, { atualizadoEm: "desc" }], take: limite,
    }),
    prisma.contato.findMany({
      where: {
        OR: [
          { nome: { contains: termo, mode: "insensitive" } }, { email: { contains: termo, mode: "insensitive" } },
          ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }, { documento: { contains: digitos } }] : []),
        ],
      },
      select: { id: true, nome: true, tipo: true, telefone: true, email: true, empresa: { select: { nome: true } } },
      orderBy: { atualizadoEm: "desc" }, take: limite,
    }),
  ]);
  return [
    ...ops.map((o): ResultadoBusca => ({
      tipo: "OPORTUNIDADE", id: o.id, titulo: o.nome, href: linkOportunidade(o),
      detalhe: `${codigoOportunidade(o.numero, o.criadoEm)} · ${o.contato.nome} · ${o.status === "EM_ANDAMENTO" ? o.etapa.nome : o.status === "GANHA" ? "Ganha" : "Perdida"}`,
    })),
    ...contatos.map((c): ResultadoBusca => ({
      tipo: "CONTATO", id: c.id, titulo: c.nome, href: `/contatos/${c.id}`,
      detalhe: [c.tipo === "EMPRESA" ? "Empresa" : "Pessoa", c.empresa?.nome, c.telefone, c.email].filter(Boolean).join(" · "),
    })),
  ];
}

export interface Aviso { chave: string; nivel: "CRITICO" | "ATENCAO" | "INFO"; titulo: string; detalhe: string; href: string }

const DIA = 86_400_000;
const fimDoDia = (agora: Date) => { const d = new Date(agora.getTime() - 3 * 3600_000); d.setUTCHours(23, 59, 59, 999); return new Date(d.getTime() + 3 * 3600_000); };

/**
 * O que pede ação do usuário agora: tarefas atrasadas ou de hoje, oportunidades atrasadas ou paradas, combinados
 * vencidos, sugestões do agente esperando decisão e reuniões sem cliente. Administrador vê também o que não tem dono.
 */
export async function avisosDoUsuario(uid: string, agora = new Date()): Promise<Aviso[]> {
  const u = await prisma.usuario.findUnique({ where: { id: uid }, select: { papel: true } });
  const meus = u?.papel === "ADMIN" ? { OR: [{ responsavelId: uid }, { responsavelId: null }] } : { responsavelId: uid };
  const [tarefas, atrasadas, paradas, combinados, sugestoes, reunioes, propostas] = await Promise.all([
    prisma.tarefa.findMany({ where: { ...meus, status: "ABERTA", paiId: null, prazoEm: { lte: fimDoDia(agora) } }, select: { id: true, titulo: true, prazoEm: true }, orderBy: { prazoEm: "asc" }, take: 30 }),
    prisma.oportunidade.findMany({ where: { ...meus, status: "EM_ANDAMENTO", finalizaEm: { lt: agora } }, select: { id: true, funilId: true, nome: true, finalizaEm: true }, orderBy: { finalizaEm: "asc" }, take: 20 }),
    prisma.oportunidade.findMany({ where: { ...meus, status: "EM_ANDAMENTO", ultimaAtividadeEm: { lt: new Date(agora.getTime() - PARADO_CRITICO_DIAS * DIA) } }, select: { id: true, funilId: true, nome: true, ultimaAtividadeEm: true }, orderBy: { ultimaAtividadeEm: "asc" }, take: 20 }),
    prisma.combinado.findMany({ where: { status: "PENDENTE", responsavel: "NOS", prazoEm: { lt: agora }, oportunidade: meus }, select: { id: true, descricao: true, prazoEm: true, oportunidade: { select: { id: true, funilId: true, nome: true } } }, orderBy: { prazoEm: "asc" }, take: 20 }),
    prisma.combinado.groupBy({ by: ["oportunidadeId"], where: { status: "SUGERIDO", oportunidade: meus }, _count: true }),
    prisma.reuniaoGoogle.count({ where: { status: "SEM_CLIENTE", conta: { usuarioId: uid } } }),
    // Resposta do cliente pelo link nos últimos 14 dias, com a oportunidade ainda aberta.
    prisma.proposta.findMany({ where: { status: { in: ["ACEITA", "RECUSADA"] }, respondidaEm: { gte: new Date(agora.getTime() - 14 * DIA) }, oportunidade: { ...meus, status: "EM_ANDAMENTO" } }, select: { id: true, status: true, respostaNome: true, oportunidade: { select: { id: true, funilId: true, nome: true } } }, orderBy: { respondidaEm: "desc" }, take: 10 }),
  ]);
  const dias = (d: Date | null) => Math.max(1, Math.floor((agora.getTime() - (d?.getTime() ?? 0)) / DIA));
  const avisos: Aviso[] = [];
  for (const p of propostas) avisos.push({ chave: `pr:${p.id}`, nivel: p.status === "ACEITA" ? "INFO" : "ATENCAO", titulo: p.oportunidade.nome, detalhe: p.status === "ACEITA" ? `${p.respostaNome} aceitou a proposta: marque como ganha` : `${p.respostaNome} recusou a proposta`, href: linkOportunidade(p.oportunidade) });
  for (const t of tarefas) {
    const atrasada = t.prazoEm! < agora;
    avisos.push({ chave: `t:${t.id}`, nivel: atrasada ? "CRITICO" : "ATENCAO", titulo: t.titulo, detalhe: atrasada ? `Tarefa atrasada há ${dias(t.prazoEm)}d` : "Tarefa para hoje", href: "/tarefas" });
  }
  for (const c of combinados) avisos.push({ chave: `c:${c.id}`, nivel: "CRITICO", titulo: c.descricao, detalhe: `Combinado vencido há ${dias(c.prazoEm)}d · ${c.oportunidade.nome}`, href: linkOportunidade(c.oportunidade) });
  for (const o of atrasadas) avisos.push({ chave: `a:${o.id}`, nivel: "ATENCAO", titulo: o.nome, detalhe: `Passou da data limite há ${dias(o.finalizaEm)}d`, href: linkOportunidade(o) });
  for (const o of paradas) avisos.push({ chave: `p:${o.id}`, nivel: "ATENCAO", titulo: o.nome, detalhe: `Sem atividade há ${dias(o.ultimaAtividadeEm)}d`, href: linkOportunidade(o) });
  if (sugestoes.length) {
    const ops = await prisma.oportunidade.findMany({ where: { id: { in: sugestoes.map((s) => s.oportunidadeId) } }, select: { id: true, funilId: true, nome: true } });
    for (const o of ops) {
      const n = sugestoes.find((s) => s.oportunidadeId === o.id)?._count ?? 0;
      avisos.push({ chave: `s:${o.id}`, nivel: "INFO", titulo: o.nome, detalhe: `${n} sugest${n === 1 ? "ão" : "ões"} do agente para decidir`, href: linkOportunidade(o) });
    }
  }
  if (reunioes) avisos.push({ chave: "r", nivel: "INFO", titulo: "Reuniões sem cliente", detalhe: `${reunioes} reuni${reunioes === 1 ? "ão" : "ões"} do Meet esperando vínculo`, href: "/configuracao?aba=google" });
  return avisos;
}
